#!/bin/sh
# Xcode Cloud post-clone script — generates the Xcode project from project.yml.
set -e

echo "Installing XcodeGen..."
brew install xcodegen

echo "Generating project..."
cd "$CI_PRIMARY_REPOSITORY_PATH/apple/OpenBrain"
xcodegen generate
