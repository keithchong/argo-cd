#!/bin/sh
###############################################################################
# This file defines the versions of the tools that are installed in the CI
# toolchain and the Docker image.
#
# Updating a tool's version here is not enough, you will need to create a
# checksum file in ./hack/installers/checksums matching the name of the
# downloaded binary with a ".sha256" suffix appended, containing the proper
# SHA256 sum of the binary.
#
# Use ./hack/installers/checksums/add-helm-checksums.sh and
# add-kustomize-checksums.sh to help download checksums.
###############################################################################
helm3_version=3.18.4
kustomize5_version=5.7.0
protoc_version=29.3
oras_version=1.2.0
