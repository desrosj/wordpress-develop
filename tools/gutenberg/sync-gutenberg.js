#!/usr/bin/env node

/**
 * Gutenberg Setup Dispatcher
 *
 * This is the postinstall entry point for Gutenberg setup. It detects whether
 * the contributor is in local repository mode (GUTENBERG_LOCAL_REPO=true in
 * their .env file) and runs the appropriate setup flow:
 *
 * - Default mode:          download pre-built zip → copy to Core
 * - Local repository mode: checkout git repo → build from source → copy to Core
 *
 * @package WordPress
 */

const { spawn } = require( 'child_process' );
const path = require( 'path' );
const { isLocalRepoMode } = require( './gutenberg-utils' );

const rootDir = path.resolve( __dirname, '../..' );

/**
 * Spawn a Node.js script and inherit stdio so output is visible in the terminal.
 *
 * @param {string}   scriptPath - Path to the script, relative to the repo root.
 * @param {string[]} args       - Arguments to pass to the script.
 * @return {Promise<void>} Promise that resolves when the script exits successfully.
 */
function runScript( scriptPath, args = [] ) {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( process.execPath, [ scriptPath, ...args ], {
			cwd: rootDir,
			stdio: 'inherit',
		} );
		child.on( 'close', ( code ) => {
			if ( code !== 0 ) {
				reject( new Error( `${ scriptPath } exited with code ${ code }` ) );
			} else {
				resolve();
			}
		} );
		child.on( 'error', reject );
	} );
}

async function main() {
	if ( isLocalRepoMode() ) {
		console.log( 'ℹ️  Local Gutenberg repository mode active (GUTENBERG_LOCAL_REPO=true).\n' );
		await runScript( 'tools/gutenberg/checkout-gutenberg.js' );
		await runScript( 'tools/gutenberg/build-gutenberg.js' );
	} else {
		await runScript( 'tools/gutenberg/download-gutenberg.js' );
	}
	await runScript( 'tools/gutenberg/copy-gutenberg-build.js', [ '--dev' ] );
}

main().catch( ( error ) => {
	console.error( '❌ Gutenberg setup failed:', error.message );
	process.exit( 1 );
} );
