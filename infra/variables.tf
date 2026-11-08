variable "project_id" {
  type        = string
  description = "GCP project id"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "api_image" {
  type        = string
  description = "Container image for the API, for example us-docker.pkg.dev/PROJECT/cic/api:0.1.0"
}

variable "web_image" {
  type        = string
  description = "Container image for the web app (built with API_URL pointing at the API Cloud Run URL)"
}

variable "oidc_issuer" {
  type        = string
  description = "Customer identity provider issuer URL"
}

variable "web_url" {
  type        = string
  description = "Public URL of the web app"
}
