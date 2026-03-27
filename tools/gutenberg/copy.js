#!/usr/bin/env node

/**
 * Copy Gutenberg Build Script
 *
 * This script copies and transforms Gutenberg's build output to WordPress Core.
 * It handles path transformations from plugin structure to Core structure.
 *
 * @package WordPress
 */

const fs = require( 'fs' );
const path = require( 'path' );
const json2php = require( 'json2php' );
const { fromString } = require( 'php-array-reader' );

// Paths.
const rootDir = path.resolve( __dirname, '../..' );
const gutenbergDir = path.join( rootDir, 'gutenberg' );
const gutenbergBuildDir = path.join( gutenbergDir, 'build' );

/*
 * Determine build target from command line argument (--dev or --build-dir).
 * Default to 'src' for development.
 */
const args = process.argv.slice( 2 );
const buildDirArg = args.find( ( arg ) => arg.startsWith( '--build-dir=' ) );
const buildTarget = buildDirArg
	? buildDirArg.split( '=' )[ 1 ]
	: args.includes( '--dev' )
	? 'src'
	: 'build';

const wpIncludesDir = path.join( rootDir, buildTarget, 'wp-includes' );

/**
 * Copy configuration.
 * Defines what to copy from Gutenberg build and where it goes in Core.
 */
const COPY_CONFIG = {
	// JavaScript packages (to wp-includes/js/dist/).
	scripts: {
		source: 'scripts',
		destination: 'js/dist',
		copyDirectories: true,
		// Rename vendors/ to vendor/ when copying.
		directoryRenames: {
			vendors: 'vendor',
		},
	},
};

/**
 * Given a path to a PHP file which returns a single value, converts that
 * value into a native JavaScript value (limited by JSON serialization).
 *
 * @throws Error when PHP source file unable to be read or parsed.
 *
 * @param {string} phpFilepath Absolute path of PHP file returning a single value.
 * @return {Object|Array} JavaScript representation of value from input file.
 */
function readReturnedValueFromPHPFile( phpFilepath ) {
	const content = fs.readFileSync( phpFilepath, 'utf8' );
	return fromString( content );
}

/**
 * Check if a block is experimental by reading its block.json.
 *
 * @param {string} blockJsonPath - Path to block.json file.
 * @return {boolean} True if block is experimental.
 */
function isExperimentalBlock( blockJsonPath ) {
	try {
		if ( ! fs.existsSync( blockJsonPath ) ) {
			return false;
		}
		const blockJson = JSON.parse(
			fs.readFileSync( blockJsonPath, 'utf8' )
		);
		return !! blockJson.__experimental;
	} catch ( error ) {
		return false;
	}
}

/**
 * Generate script-modules-packages.php from individual asset files.
 * Recursively scans the Gutenberg modules/ directory for *.min.asset.php files
 * and combines their contents into a single PHP file.
 */
function generateScriptModulesPackages() {
	const modulesDir = path.join( gutenbergBuildDir, 'modules' );
	const assets = {};

	/**
	 * Recursively process directory to find .asset.php files.
	 *
	 * @param {string} dir - Directory to process.
	 * @param {string} baseDir - Base directory for relative paths.
	 */
	function processDirectory( dir, baseDir ) {
		if ( ! fs.existsSync( dir ) ) {
			return;
		}

		const entries = fs.readdirSync( dir, { withFileTypes: true } );

		for ( const entry of entries ) {
			const fullPath = path.join( dir, entry.name );

			if ( entry.isDirectory() ) {
				// Skip plugin-only packages (e.g., vips/wasm) that should not be in Core.
				if ( entry.name === 'vips' ) {
					continue;
				}
				processDirectory( fullPath, baseDir );
			} else if ( entry.name.endsWith( '.min.asset.php' ) ) {
				const relativePath = path.relative( baseDir, fullPath );
				// Normalize path separators to forward slashes for cross-platform consistency.
				const normalizedPath = relativePath
					.split( path.sep )
					.join( '/' );
				const jsPath = normalizedPath
					.replace( /\.asset\.php$/, '.js' )
					.replace( /\.min\.js$/, '.js' );

				try {
					const assetData = readReturnedValueFromPHPFile( fullPath );
					assets[ jsPath ] = assetData;
				} catch ( error ) {
					console.error(
						`   ⚠️  Error reading ${ relativePath }:`,
						error.message
					);
				}
			}
		}
	}

	processDirectory( modulesDir, modulesDir );

	const phpContent =
		'<?php return ' +
		json2php.make( {
			linebreak: '\n',
			indent: '\t',
			shortArraySyntax: false,
		} )( assets ) +
		';';

	const outputPath = path.join(
		wpIncludesDir,
		'assets/script-modules-packages.php'
	);

	fs.mkdirSync( path.dirname( outputPath ), { recursive: true } );
	fs.writeFileSync( outputPath, phpContent );

	console.log(
		`   ✅ Generated with ${ Object.keys( assets ).length } modules`
	);
}

/**
 * Generate script-loader-packages.php from individual asset files.
 * Reads all .min.asset.php files from scripts/ and combines them into a PHP file for script registration.
 */
function generateScriptLoaderPackages() {
	const scriptsDir = path.join( gutenbergBuildDir, 'scripts' );
	const assets = {};

	if ( ! fs.existsSync( scriptsDir ) ) {
		console.log( '   ⚠️  Scripts directory not found' );
		return;
	}

	const entries = fs.readdirSync( scriptsDir, { withFileTypes: true } );

	for ( const entry of entries ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}

		const assetFile = path.join(
			scriptsDir,
			entry.name,
			'index.min.asset.php'
		);
		if ( ! fs.existsSync( assetFile ) ) {
			continue;
		}

		try {
			const assetData = readReturnedValueFromPHPFile( assetFile );

			// For regular scripts, use dependencies as-is.
			if ( ! assetData.dependencies ) {
				assetData.dependencies = [];
			}

			// Strip plugin-only module dependencies (e.g., vips) that are not in Core.
			if ( Array.isArray( assetData.module_dependencies ) ) {
				assetData.module_dependencies =
					assetData.module_dependencies.filter(
						( dep ) =>
							! ( dep.id || dep ).startsWith(
								'@wordpress/vips'
							)
					);
			}

			assets[ `${ entry.name }.js` ] = assetData;
		} catch ( error ) {
			console.error(
				`   ⚠️  Error reading ${ entry.name }/index.min.asset.php:`,
				error.message
			);
		}
	}

	const phpContent =
		'<?php return ' +
		json2php.make( {
			linebreak: '\n',
			indent: '\t',
			shortArraySyntax: false,
		} )( assets ) +
		';';

	const outputPath = path.join(
		wpIncludesDir,
		'assets/script-loader-packages.php'
	);

	fs.mkdirSync( path.dirname( outputPath ), { recursive: true } );
	fs.writeFileSync( outputPath, phpContent );

	console.log(
		`   ✅ Generated with ${ Object.keys( assets ).length } packages`
	);
}

/**
 * Generate require-dynamic-blocks.php and require-static-blocks.php.
 * Reads all block.json files from wp-includes/blocks and categorizes them.
 * Only includes blocks from block-library, not widgets.
 */
function generateBlockRegistrationFiles() {
	const blocksDir = path.join( wpIncludesDir, 'blocks' );
	const dynamicBlocks = [];
	const staticBlocks = [];

	// Widget blocks to exclude (from @wordpress/widgets package).
	const widgetBlocks = [ 'legacy-widget', 'widget-group' ];

	if ( ! fs.existsSync( blocksDir ) ) {
		console.error( '   ⚠️  Blocks directory not found' );
		return;
	}

	const entries = fs.readdirSync( blocksDir, { withFileTypes: true } );

	for ( const entry of entries ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}

		// Skip widget blocks.
		if ( widgetBlocks.includes( entry.name ) ) {
			continue;
		}

		const blockDir = path.join( blocksDir, entry.name );
		const blockJsonPath = path.join( blockDir, 'block.json' );
		const phpFilePath = path.join( blocksDir, `${ entry.name }.php` );

		// Skip if block.json doesn't exist.
		if ( ! fs.existsSync( blockJsonPath ) ) {
			continue;
		}

		// Check if it's experimental.
		if ( isExperimentalBlock( blockJsonPath ) ) {
			continue;
		}

		// Determine if it's dynamic (has a PHP file).
		if ( fs.existsSync( phpFilePath ) ) {
			dynamicBlocks.push( entry.name );
		} else {
			staticBlocks.push( entry.name );
		}
	}

	// Sort alphabetically.
	dynamicBlocks.sort();
	staticBlocks.sort();

	// Generate require-dynamic-blocks.php.
	const dynamicContent = `<?php

// This file was autogenerated by tools/gutenberg/copy.js, do not change manually!
// Requires files for dynamic blocks necessary for core blocks registration.
${ dynamicBlocks
	.map(
		( name ) => `require_once ABSPATH . WPINC . '/blocks/${ name }.php';`
	)
	.join( '\n' ) }
`;

	fs.writeFileSync(
		path.join( wpIncludesDir, 'blocks/require-dynamic-blocks.php' ),
		dynamicContent
	);

	// Generate require-static-blocks.php.
	const staticContent = `<?php

// This file was autogenerated by tools/gutenberg/copy.js, do not change manually!
// Returns folder names for static blocks necessary for core blocks registration.
return array(
${ staticBlocks.map( ( name ) => `\t'${ name }',` ).join( '\n' ) }
);
`;

	fs.writeFileSync(
		path.join( wpIncludesDir, 'blocks/require-static-blocks.php' ),
		staticContent
	);

	console.log(
		`   ✅ Generated: ${ dynamicBlocks.length } dynamic, ${ staticBlocks.length } static blocks`
	);
}

/**
 * Generate blocks-json.php from all block.json files.
 * Reads all block.json files and combines them into a single PHP array.
 * Uses json2php to maintain consistency with Core's formatting.
 */
function generateBlocksJson() {
	const blocksDir = path.join( wpIncludesDir, 'blocks' );
	const blocks = {};

	if ( ! fs.existsSync( blocksDir ) ) {
		console.error( '   ⚠️  Blocks directory not found' );
		return;
	}

	const entries = fs.readdirSync( blocksDir, { withFileTypes: true } );

	for ( const entry of entries ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}

		const blockJsonPath = path.join( blocksDir, entry.name, 'block.json' );

		if ( fs.existsSync( blockJsonPath ) ) {
			try {
				const blockJson = JSON.parse(
					fs.readFileSync( blockJsonPath, 'utf8' )
				);
				blocks[ entry.name ] = blockJson;
			} catch ( error ) {
				console.error(
					`   ⚠️  Error reading ${ entry.name }/block.json:`,
					error.message
				);
			}
		}
	}

	// Generate the PHP file content using json2php for consistent formatting.
	const phpContent =
		'<?php return ' +
		json2php.make( {
			linebreak: '\n',
			indent: '\t',
			shortArraySyntax: false,
		} )( blocks ) +
		';';

	fs.writeFileSync(
		path.join( wpIncludesDir, 'blocks/blocks-json.php' ),
		phpContent
	);

	console.log(
		`   ✅ Generated with ${ Object.keys( blocks ).length } blocks`
	);
}

/**
 * Main execution function.
 */
async function main() {
	console.log( `📦 Copying Gutenberg build to ${ buildTarget }/...` );

	if ( ! fs.existsSync( gutenbergBuildDir ) ) {
		console.error( '❌ Gutenberg build directory not found' );
		console.error( '   Run: npm run grunt gutenberg:download' );
		process.exit( 1 );
	}

	// 1. Copy JavaScript packages.
	console.log( '\n📦 Copying JavaScript packages...' );
	const scriptsConfig = COPY_CONFIG.scripts;
	const scriptsSrc = path.join( gutenbergBuildDir, scriptsConfig.source );
	const scriptsDest = path.join( wpIncludesDir, scriptsConfig.destination );

	if ( fs.existsSync( scriptsSrc ) ) {
		const entries = fs.readdirSync( scriptsSrc, { withFileTypes: true } );

		for ( const entry of entries ) {
			const src = path.join( scriptsSrc, entry.name );

			if ( entry.isDirectory() ) {
				// Check if this should be copied as a directory (like vendors/).
				if (
					scriptsConfig.copyDirectories &&
					scriptsConfig.directoryRenames &&
					scriptsConfig.directoryRenames[ entry.name ]
				) {
					/*
					 * Copy special directories with rename (vendors/ → vendor/).
					 * Only copy react-jsx-runtime from vendors (react and react-dom come from Core's node_modules).
					 */
					const destName =
						scriptsConfig.directoryRenames[ entry.name ];
					const dest = path.join( scriptsDest, destName );

					if ( entry.name === 'vendors' ) {
						// Only copy react-jsx-runtime files, skip react and react-dom.
						const vendorFiles = fs.readdirSync( src );
						let copiedCount = 0;
						fs.mkdirSync( dest, { recursive: true } );
						for ( const file of vendorFiles ) {
							if (
								file.startsWith( 'react-jsx-runtime' ) &&
								file.endsWith( '.js' )
							) {
								const srcFile = path.join( src, file );
								const destFile = path.join( dest, file );

								fs.copyFileSync( srcFile, destFile );
								copiedCount++;
							}
						}
						console.log(
							`   ✅ ${ entry.name }/ → ${ destName }/ (react-jsx-runtime only, ${ copiedCount } files)`
						);
					}
				} else {
					/*
					 * Flatten package structure: package-name/index.js → package-name.js.
					 * This matches Core's expected file structure.
					 */
					const packageFiles = fs.readdirSync( src );

					for ( const file of packageFiles ) {
						if (
							/^index\.(js|min\.js)$/.test( file )
						) {
							const srcFile = path.join( src, file );
							// Replace 'index.' with 'package-name.'.
							const destFile = file.replace(
								/^index\./,
								`${ entry.name }.`
							);
							const destPath = path.join( scriptsDest, destFile );

							fs.mkdirSync( path.dirname( destPath ), {
								recursive: true,
							} );

							fs.copyFileSync( srcFile, destPath );
						}
					}
				}
			} else if ( entry.isFile() && entry.name.endsWith( '.js' ) ) {
				// Copy root-level JS files.
				const dest = path.join( scriptsDest, entry.name );
				fs.mkdirSync( path.dirname( dest ), { recursive: true } );
				fs.copyFileSync( src, dest );
			}
		}

		console.log( '   ✅ JavaScript packages copied' );
	}

	// 2. Generate script-modules-packages.php from individual asset files.
	console.log( '\n📦 Generating script-modules-packages.php...' );
	generateScriptModulesPackages();

	// 3. Generate script-loader-packages.php.
	console.log( '\n📦 Generating script-loader-packages.php...' );
	generateScriptLoaderPackages();

	// 4. Generate require-dynamic-blocks.php and require-static-blocks.php.
	console.log( '\n📦 Generating block registration files...' );
	generateBlockRegistrationFiles();

	// 5. Generate blocks-json.php from block.json files.
	console.log( '\n📦 Generating blocks-json.php...' );
	generateBlocksJson();

	console.log( '\n✅ Copy complete!' );
}

// Run main function.
main().catch( ( error ) => {
	console.error( '❌ Unexpected error:', error );
	process.exit( 1 );
} );
