import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, remove, serverTimestamp, set, update } from "firebase/database";

const projectId = "demo-companion-desk";
let testEnv: RulesTestEnvironment;

function databaseFor(uid: string) {
  return testEnv.authenticatedContext(uid).database();
}

async function seed(data: unknown) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database()), data);
  });
}

async function seedMutualFriends() {
  await seed({
    friends: {
      alice: { bob: { acceptedAt: 1 } },
      bob: { alice: { acceptedAt: 1 } },
    },
  });
}

beforeAll(async () => {
  const rules = await readFile(new URL("../../database.rules.json", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({ projectId, database: { rules } });
});

beforeEach(async () => {
  await testEnv.clearDatabase();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe("Realtime Database friend rules", () => {
  it("denies parent enumeration while allowing an authenticated exact-code read", async () => {
    await seed({ friendCodes: { "48271936": "alice" } });

    await assertFails(get(ref(databaseFor("bob"), "friendCodes")));
    await expect(assertSucceeds(get(ref(databaseFor("bob"), "friendCodes/48271936")))).resolves.toMatchObject({ exists: expect.any(Function) });
  });

  it("rejects a friend-code collision", async () => {
    await seed({ friendCodes: { "48271936": "alice" } });

    await assertFails(set(ref(databaseFor("bob"), "friendCodes/48271936"), "bob"));
  });

  it("rejects a forged requester", async () => {
    await assertFails(set(ref(databaseFor("alice"), "requests/bob/mallory"), { createdAt: serverTimestamp() }));
  });

  it("allows a requester to create one pending request with a server timestamp", async () => {
    await assertSucceeds(set(ref(databaseFor("alice"), "requests/bob/alice"), { createdAt: serverTimestamp() }));
  });

  it("allows the requester to withdraw their own pending request", async () => {
    await seed({ requests: { bob: { alice: { createdAt: 1 } } } });

    await assertSucceeds(remove(ref(databaseFor("alice"), "requests/bob/alice")));
  });

  it("allows a requester reset to idempotently delete an already-ignored outgoing request", async () => {
    await seed({
      profiles: { alice: { displayName: "Alice", createdAt: 1 } },
      friendCodes: { "48271936": "alice" },
    });

    await assertSucceeds(update(ref(databaseFor("alice")), {
      "profiles/alice": null,
      "friendCodes/48271936": null,
      "requests/bob/alice": null,
    }));
  });

  it("rejects another user withdrawing someone else's pending request", async () => {
    await seed({ requests: { bob: { alice: { createdAt: 1 } } } });

    await assertFails(remove(ref(databaseFor("mallory"), "requests/bob/alice")));
  });

  it("does not let a third party delete or write another requester's request slot", async () => {
    await assertFails(remove(ref(databaseFor("mallory"), "requests/bob/alice")));
    await assertFails(set(ref(databaseFor("mallory"), "requests/bob/alice"), {
      createdAt: serverTimestamp(),
    }));
  });

  it("allows only the request recipient to atomically accept both friend mirrors", async () => {
    await seed({ requests: { bob: { alice: { createdAt: 1 } } } });

    await assertFails(update(ref(databaseFor("mallory")), {
      "friends/alice/bob": { acceptedAt: 2 },
      "friends/bob/alice": { acceptedAt: 2 },
      "requests/bob/alice": null,
    }));

    await assertFails(set(ref(databaseFor("bob"), "friends/bob/alice"), { acceptedAt: 2 }));

    await assertSucceeds(update(ref(databaseFor("bob")), {
      "friends/alice/bob": { acceptedAt: 2 },
      "friends/bob/alice": { acceptedAt: 2 },
      "requests/bob/alice": null,
    }));
  });

  it("rejects a poke from a stranger", async () => {
    await assertFails(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "stranger",
      createdAt: serverTimestamp(),
    }));
  });

  it("rejects a forged poke timestamp between mutual friends", async () => {
    await seedMutualFriends();
    await assertFails(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "forged-time",
      createdAt: 1,
    }));
  });

  it("rejects a second poke during the thirty-second cooldown", async () => {
    await seed({
      friends: {
        alice: { bob: { acceptedAt: 1 } },
        bob: { alice: { acceptedAt: 1 } },
      },
      pokes: { bob: { alice: { eventId: "first", createdAt: Date.now() } } },
    });

    await assertFails(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "too-soon",
      createdAt: serverTimestamp(),
    }));
  });

  it("allows an initial poke and an overwrite after the thirty-second cooldown", async () => {
    await seedMutualFriends();

    await assertSucceeds(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "initial",
      createdAt: serverTimestamp(),
    }));

    await seed({
      friends: {
        alice: { bob: { acceptedAt: 1 } },
        bob: { alice: { acceptedAt: 1 } },
      },
      pokes: { bob: { alice: { eventId: "old", createdAt: Date.now() - 35_000 } } },
    });
    await assertSucceeds(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "after-cooldown",
      createdAt: serverTimestamp(),
    }));
  });

  it("rejects unknown profile fields while accepting the declared profile shape", async () => {
    const profile = {
      displayName: "Alice",
      createdAt: 1,
    };
    await assertSucceeds(set(ref(databaseFor("alice"), "profiles/alice"), profile));
    await assertFails(update(ref(databaseFor("alice"), "profiles/alice"), { unexpected: true }));
  });

  it("rejects unknown request fields while accepting the declared request shape", async () => {
    await assertFails(set(ref(databaseFor("alice"), "requests/bob/alice"), {
      createdAt: serverTimestamp(),
      unexpected: true,
    }));
    await assertSucceeds(set(ref(databaseFor("alice"), "requests/bob/alice"), { createdAt: serverTimestamp() }));
  });

  it("rejects unknown friend fields while accepting atomic mirrored friendship", async () => {
    await seed({ requests: { bob: { alice: { createdAt: 1 } } } });
    await assertFails(update(ref(databaseFor("bob")), {
      "friends/alice/bob": { acceptedAt: 2, unexpected: true },
      "friends/bob/alice": { acceptedAt: 2 },
      "requests/bob/alice": null,
    }));
    await assertSucceeds(update(ref(databaseFor("bob")), {
      "friends/alice/bob": { acceptedAt: 2 },
      "friends/bob/alice": { acceptedAt: 2 },
      "requests/bob/alice": null,
    }));
  });

  it("rejects unknown poke fields while accepting the declared poke shape", async () => {
    await seedMutualFriends();
    await assertFails(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "unknown-field",
      createdAt: serverTimestamp(),
      unexpected: true,
    }));
    await assertSucceeds(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "allowed",
      createdAt: serverTimestamp(),
    }));
  });

  it("lets only the recipient delete a poke after twenty-four hours", async () => {
    await seed({ pokes: { bob: { alice: { eventId: "recent", createdAt: Date.now() } } } });
    await assertFails(remove(ref(databaseFor("bob"), "pokes/bob/alice")));

    await seed({ pokes: { bob: { alice: { eventId: "stale", createdAt: Date.now() - 90_000_000 } } } });
    await assertSucceeds(remove(ref(databaseFor("bob"), "pokes/bob/alice")));
  });

  it("rejects a poke immediately after either friend removes the mirrored friendship", async () => {
    await seedMutualFriends();
    await assertSucceeds(update(ref(databaseFor("alice")), {
      "friends/alice/bob": null,
      "friends/bob/alice": null,
    }));

    await assertFails(set(ref(databaseFor("alice"), "pokes/bob/alice"), {
      eventId: "after-remove",
      createdAt: serverTimestamp(),
    }));
  });

  it("rejects an atomic update that removes both friend mirrors and writes a poke", async () => {
    await seedMutualFriends();

    await assertFails(update(ref(databaseFor("alice")), {
      "friends/alice/bob": null,
      "friends/bob/alice": null,
      "pokes/bob/alice": { eventId: "remove-and-poke", createdAt: serverTimestamp() },
    }));
  });
});
