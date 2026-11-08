# Terraform (GCP)

Cloud Run (api, web), Cloud SQL for Postgres 16, a landing bucket and Secret Manager.

Status: written and reviewed by reading. `terraform validate` was NOT run (the tool is not installed on the build machine). CI runs `terraform init -backend=false` and `terraform validate`. Nothing has ever been applied.

    terraform init
    terraform plan -var project_id=... -var api_image=... -var web_image=... -var oidc_issuer=... -var web_url=...
