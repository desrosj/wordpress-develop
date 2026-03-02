#!/usr/bin/env node

/**
 * Gutenberg build utilities.
 *
 * Shared helpers used by the Gutenberg download script. When run directly,
 * verifies that the installed Gutenberg build matches the SHA in package.json.
 *
 * @package WordPress
 */

const crypto = require( 'crypto' );
const fs = require( 'fs' );
const path = require( 'path' );

// Paths
const rootDir = path.resolve( __dirname, '../..' );
const gutenbergDir = path.join( rootDir, 'gutenberg' );
const gutenbergDirHashFile = path.join( rootDir, '.gutenberg-dir-hash' );

/**
 * Read Gutenberg configuration from package.json.
 *
 * @return {{ sha: string, ghcrRepo: string }} The Gutenberg configuration.
 * @throws {Error} If the configuration is missing or invalid.
 */
function readGutenbergConfig() {
	const packageJson = require( path.join( rootDir, 'package.json' ) );
	const sha = packageJson.gutenberg?.sha;
	const ghcrRepo = packageJson.gutenberg?.ghcrRepo;

	if ( ! sha ) {
		throw new Error( 'Missing "gutenberg.sha" in package.json' );
	}

	if ( ! ghcrRepo ) {
		throw new Error( 'Missing "gutenberg.ghcrRepo" in package.json' );
	}

	return { sha, ghcrRepo };
}

/**
 * Verify that the installed Gutenberg version matches the expected SHA in
 * package.json. Logs progress to the console and exits with a non-zero code
 * on failure.
 */
function verifyGutenbergVersion() {
	console.log( '\n🔍 Verifying Gutenberg version...' );

	let sha;
	try {
		( { sha } = readGutenbergConfig() );
	} catch ( error ) {
		console.error( '❌ Error reading package.json:', error.message );
		process.exit( 1 );
	}

	const hashFilePath = path.join( gutenbergDir, '.gutenberg-hash' );
	try {
		const installedHash = fs.readFileSync( hashFilePath, 'utf8' ).trim();
		if ( installedHash !== sha ) {
			console.error(
				`❌ SHA mismatch: expected ${ sha } but found ${ installedHash }. Run \`npm run grunt gutenberg-download -- --force\` to download the correct version.`
			);
			process.exit( 1 );
		}
	} catch ( error ) {
		if ( error.code === 'ENOENT' ) {
			console.error( `❌ .gutenberg-hash not found. Run \`npm run grunt gutenberg-download\` to download Gutenberg.` );
		} else {
			console.error( `❌ ${ error.message }` );
		}
		process.exit( 1 );
	}

	console.log( '✅ Version verified' );
}

/**
 * Calculate a hash of the Gutenberg directory and all its contents.
 *
 * This stores the hash of the Gutenberg directory in a `.gutenberg-hash` file
 * to track when changes have been made to those files locally.
 *
 * Files are processed in sorted order so the result is deterministic. The hash
 * incorporates each file's relative path and its contents.
 */
function hashGutenbergDir() {
	const hash = crypto.createHash( 'sha256' );

	/**
	 * Recursively collect all file paths under a directory, sorted.
	 *
	 * @param {string} dir - Directory to walk.
	 * @return {string[]} Sorted list of absolute file paths.
	 */
	function collectFiles( dir ) {
		const files = [];
		for ( const entry of fs.readdirSync( dir, { withFileTypes: true } ).sort( ( a, b ) => a.name.localeCompare( b.name ) ) ) {
			const fullPath = path.join( dir, entry.name );
			if ( entry.isDirectory() ) {
				files.push( ...collectFiles( fullPath ) );
			} else {
				files.push( fullPath );
			}
		}
		return files;
	}

	for ( const filePath of collectFiles( gutenbergDir ) ) {
		// Hash the relative path so the result is location-independent.
		hash.update( path.relative( gutenbergDir, filePath ) );
		hash.update( fs.readFileSync( filePath ) );
	}

	const digest = hash.digest( 'hex' );
	fs.writeFileSync( gutenbergDirHashFile, digest );
	return digest;
}

/**
 * Checks for changes to the local gutenberg directory.
 *
 * This detects changes to the local gutenberg directory that have occurred since
 * the directory was created, which may cause unexpected results.
 */
function checkGutenbergDirHash() {
	if ( ! fs.existsSync( gutenbergDirHashFile ) ) {
		console.warn( '⚠️  .gutenberg-dir-hash not found. Files in the gutenberg directory may have changed since downloading.' );
		return;
	}

	const storedHash = fs.readFileSync( gutenbergDirHashFile, 'utf8' ).trim();
	const currentHash = hashGutenbergDir();

	if ( currentHash !== storedHash ) {
		console.warn( '⚠️  The gutenberg directory has changed since the last copy. The build scripts may produce unexpected results.' );
		return;
	}

	console.log( '✅ The contents of the gutenberg directory have not been modified.' );
}

module.exports = { rootDir, gutenbergDir, readGutenbergConfig, verifyGutenbergVersion, hashGutenbergDir, checkGutenbergDirHash };

if ( require.main === module ) {
	verifyGutenbergVersion();

	checkGutenbergDirHash();
}
