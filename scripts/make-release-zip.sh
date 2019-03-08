#!/bin/bash

mkdir -p release
current_commit="$(git rev-parse --short HEAD)"
zipfile="release/aws-slack-codepipeline-watch-release-${1:-$current_commit}.zip"
echo ">> Installing node_module production"
mv node_modules node_modules.bak
NODE_ENV=production npm -q i 

echo ">> Generating Zip file"
zip -r -q "$zipfile" node_modules lambda

echo ">> Restoring noode_module with dev dependencies"
rm -rf node_modules
mv node_modules.bak node_modules
echo 
echo ">> Zip available: $zipfile"
