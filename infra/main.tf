# Cloud Run (api + web), Cloud SQL Postgres, a landing bucket for raw files, secrets in Secret Manager.
# Written to be read and reviewed. Not applied by anyone yet.

resource "google_service_account" "api" {
  account_id   = "cic-api"
  display_name = "Integration console API"
}

# Landing bucket for raw customer files. The app does not read from it yet (see docs/DECISIONS.md).
resource "google_storage_bucket" "landing" {
  name                        = "${var.project_id}-cic-landing"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning { enabled = true }
  lifecycle_rule {
    condition { age = 90 }
    action { type = "Delete" }
  }
}

resource "google_storage_bucket_iam_member" "api_landing" {
  bucket = google_storage_bucket.landing.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "pg" {
  name                = "cic-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true
  settings {
    tier = "db-f1-micro"
    backup_configuration { enabled = true }
    # Cloud Run connects through the Cloud SQL connector
    ip_configuration {
      ipv4_enabled = true
    }
  }
}

resource "google_sql_database" "cic" {
  name     = "cic"
  instance = google_sql_database_instance.pg.name
}

resource "google_sql_user" "cic" {
  name     = "cic"
  instance = google_sql_database_instance.pg.name
  password = random_password.db.result
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "cic-database-url"
  replication { auto {} }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgres://cic:${random_password.db.result}@/cic?host=/cloudsql/${google_sql_database_instance.pg.connection_name}"
}

resource "google_secret_manager_secret_iam_member" "api_db" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "cic-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance { instances = [google_sql_database_instance.pg.connection_name] }
    }
    containers {
      image = var.api_image
      ports { container_port = 4000 }
      env {
        name  = "OIDC_ISSUER"
        value = var.oidc_issuer
      }
      env {
        name  = "WEB_URL"
        value = var.web_url
      }
      env {
        name  = "COOKIE_SECURE"
        value = "true"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.database_url]
}

resource "google_cloud_run_v2_service" "web" {
  name     = "cic-web"
  location = var.region
  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }
    containers {
      image = var.web_image
      ports { container_port = 3000 }
    }
  }
}

# The web app is public; the browser signs in through the identity provider.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The API is called by the web app's server-side proxy. See docs/DECISIONS.md for the open point on locking it down.
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
