const fs = require( 'fs' );
const dotenv       = require( 'dotenv' ).parse(fs.readFileSync('.env') );
const dotenvExpand = require( 'dotenv-expand' );
const { execSync } = require( 'child_process' );

dotenvExpand( dotenv );


// Execute any docker-compose command passed to this script.
execSync( 'docker-compose ' + process.argv.slice( 2 ).join( ' ' ), { stdio: 'inherit' } );
