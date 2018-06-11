#!/bin/bash

current_commit="$(git rev-parse --short HEAD)"
zipfile="aws-slack-codepipeline-watch-release-${1:-$current_commit}.zip"
echo ">> Installing node_module production"
rm -rf node_modules
NODE_ENV=production npm -q i 

echo ">> Generating Zip file"
zip -r -q "$zipfile" node_modules aws-slack-codepipeline-watch.js

echo ">> Reinstalling noode_module with dev dependencies"
npm -q i
echo 
echo ">> Zip available: $zipfile"