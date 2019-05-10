#!/usr/bin/env bash

test -e ../settings.json || echo {} > ../settings.json
test -e ../data/parameters || mkdir -p ../data/parameters;

for f in $(find ./src/transitions -type f -name '*.js' -not -name 'index.js'); do \
  FILENAME=../data/parameters/"`basename $f .js`".json;
  test -e $FILENAME || node -r fs -e "console.log(JSON.stringify(require(\"$f\").defaultParams, null, 2))" > $FILENAME;
done;
