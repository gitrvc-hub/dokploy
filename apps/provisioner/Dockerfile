# Stage 1: Build Go binary
FROM golang:1.23-bookworm AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o provisioner .

# Stage 2: Download Terraform
FROM debian:bookworm-slim AS terraform-downloader

ARG TERRAFORM_VERSION=1.10.5
ARG TARGETARCH

RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*
RUN ARCH=${TARGETARCH:-amd64} && \
    curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${ARCH}.zip" \
    -o /tmp/terraform.zip && \
    unzip /tmp/terraform.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/terraform && \
    rm /tmp/terraform.zip

# Stage 3: Final image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates openssh-client && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/provisioner /usr/local/bin/provisioner
COPY --from=terraform-downloader /usr/local/bin/terraform /usr/local/bin/terraform

RUN mkdir -p /tmp/provisioner/terraform

ENV PORT=4600
EXPOSE 4600

ENTRYPOINT ["provisioner"]
