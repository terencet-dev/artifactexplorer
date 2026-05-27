#!/bin/bash
set -e

echo "Building Artifact Explorer..."

# Clean previous build
echo "Cleaning previous build..."
rm -rf .next
rm -rf out

# Install dependencies
echo "Installing dependencies..."
npm ci

# Run linting
echo "Running linting checks..."
npm run lint

# Build the application
echo "Building production bundle..."
npm run build

# Output success message
echo "✅ Build complete!"
echo "The production build is available in the '.next' directory."
echo "To test the production build locally, run: npm run start" 