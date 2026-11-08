output "web_url" { value = google_cloud_run_v2_service.web.uri }
output "api_url" { value = google_cloud_run_v2_service.api.uri }
output "landing_bucket" { value = google_storage_bucket.landing.name }
output "db_connection_name" { value = google_sql_database_instance.pg.connection_name }
