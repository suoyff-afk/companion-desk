fn main() {
    let mut arguments = std::env::args().skip(1);
    let Some(alias) = arguments.next() else {
        eprintln!("Usage: hpc_snapshot <ssh-host-alias> [job-id ...]");
        std::process::exit(2);
    };
    match kunkun_desk_lib::hpc_query::query_hpc_jobs_blocking(alias, arguments.collect()) {
        Ok(snapshot) => println!("{}", serde_json::to_string(&snapshot).expect("serializable snapshot")),
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    }
}
