/**
 * Renders the results of comparing the `build` directory with WordPress/WordPress as Markdown.
 *
 * The comparison directory must contain the files written by the Compare Built Files workflow:
 *
 * - metadata.json:   Details about what was compared.
 * - name-status.txt: Output of `git diff --name-status`.
 * - numstat.txt:     Output of `git diff --numstat`.
 * - changes.diff:    The full diff.
 *
 * These files can originate from an untrusted pull request, so every value is validated or escaped before it is used.
 *
 * Environment variables:
 *
 * - COMPARISON_DIR: Directory containing the comparison files.
 * - OUTPUT_FILE:    File to write the Markdown report to.
 * - MAX_LENGTH:     Maximum length of the report, in characters.
 * - HEAD_SHA:       Optional. Overrides the commit SHA in metadata.json with a trusted value.
 * - RUN_URL:        URL of the workflow run where the complete comparison can be downloaded.
 */
const fs = require( 'fs' );
const path = require( 'path' );

const { COMPARISON_DIR, OUTPUT_FILE, MAX_LENGTH, HEAD_SHA, RUN_URL, GITHUB_SERVER_URL, GITHUB_REPOSITORY } =
	process.env;

const STATUS_LABELS = {
	A: 'Added',
	D: 'Removed',
	M: 'Modified',
	T: 'Type changed',
};

const read = ( file ) => fs.readFileSync( path.join( COMPARISON_DIR, file ), 'utf8' );

const assertMatches = ( name, value, pattern ) => {
	if ( typeof value !== 'string' || ! pattern.test( value ) ) {
		throw new Error( `Invalid value for ${ name }: ${ JSON.stringify( value ) }` );
	}
	return value;
};

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SVN_PATH_PATTERN = /^(trunk|branches\/[0-9]+\.[0-9]+)$/;
const BRANCH_PATTERN = /^(master|[0-9]+\.[0-9]+-branch)$/;
const BUILT_FROM_PATTERN = /^(trunk|branches\/[0-9]+\.[0-9]+)@[0-9]+$/;
const FILE_PATTERN = /^[\w./@+-][\w ./@+-]*$/;

const rawMetadata = JSON.parse( read( 'metadata.json' ) );
const metadata = {
	headSha: assertMatches( 'headSha', HEAD_SHA || rawMetadata.headSha, SHA_PATTERN ),
	svnPath: assertMatches( 'svnPath', rawMetadata.svnPath, SVN_PATH_PATTERN ),
	svnRevision: assertMatches( 'svnRevision', rawMetadata.svnRevision, /^[0-9]+$/ ),
	buildServerSha: assertMatches( 'buildServerSha', rawMetadata.buildServerSha, SHA_PATTERN ),
	buildServerBranch: assertMatches( 'buildServerBranch', rawMetadata.buildServerBranch, BRANCH_PATTERN ),
	builtFrom: assertMatches( 'builtFrom', rawMetadata.builtFrom, BUILT_FROM_PATTERN ),
	exactMatch: rawMetadata.exactMatch === true,
	isPullRequest: rawMetadata.isPullRequest === true,
	modifiedTrackedFiles: ( Array.isArray( rawMetadata.modifiedTrackedFiles ) ? rawMetadata.modifiedTrackedFiles : [] )
		.filter( ( file ) => typeof file === 'string' && FILE_PATTERN.test( file ) ),
};

/**
 * Escapes text for use inside an HTML element within a Markdown table cell.
 */
const escapeHtml = ( value ) =>
	value.replace( /[&<>"'|`\\\n\r]/g, ( char ) => `&#${ char.charCodeAt( 0 ) };` );

/**
 * Returns a code fence that is longer than any run of backticks in the content.
 */
const fenceFor = ( content ) => {
	const runs = content.match( /`+/g ) || [];
	return '`'.repeat( Math.max( 2, ...runs.map( ( run ) => run.length ) ) + 1 );
};

/**
 * Splits a line of `git diff` output into its leading fields and the file name, which may contain tabs.
 */
const splitFields = ( line, count ) => {
	const fields = line.split( '\t' );
	return [ ...fields.slice( 0, count ), fields.slice( count ).join( '\t' ) ];
};

// Lines added and removed for each file. Binary files are reported as "-".
const lineCounts = new Map();
for ( const line of read( 'numstat.txt' ).split( '\n' ).filter( Boolean ) ) {
	const [ added, removed, file ] = splitFields( line, 2 );
	lineCounts.set( file, added === '-' ? 'binary' : `+${ Number( added ) } −${ Number( removed ) }` );
}

const files = read( 'name-status.txt' )
	.split( '\n' )
	.filter( Boolean )
	.map( ( line ) => {
		const [ status, name ] = splitFields( line, 1 );
		return { status: STATUS_LABELS[ status[ 0 ] ] || 'Changed', name, lines: lineCounts.get( name ) || '' };
	} );

// Seeded so the counts are always listed in the same order.
const counts = new Map( Object.values( STATUS_LABELS ).map( ( label ) => [ label, 0 ] ) );
for ( const { status } of files ) {
	counts.set( status, ( counts.get( status ) || 0 ) + 1 );
}

const diff = read( 'changes.diff' );
const repositoryUrl = `${ GITHUB_SERVER_URL }/${ GITHUB_REPOSITORY }`;
const buildServerUrl = 'https://github.com/WordPress/WordPress';
const short = ( sha ) => sha.slice( 0, 7 );
const svnLabel = `${ metadata.svnPath }@${ metadata.svnRevision }`;

/**
 * Builds the Markdown report, keeping it within the given number of characters.
 */
function buildReport( maxLength ) {
	let header = '## Build Server Comparison\n\n';

	header += '| | |\n| --- | --- |\n';
	header += `| Build script output | [\`${ short( metadata.headSha ) }\`](${ repositoryUrl }/commit/${ metadata.headSha }) `;
	header += metadata.isPullRequest ? `merged into \`${ svnLabel }\` |\n` : `(\`${ svnLabel }\`) |\n`;
	header += `| Compared to | [WordPress/WordPress@\`${ short( metadata.buildServerSha ) }\`](${ buildServerUrl }/commit/${ metadata.buildServerSha }) `;
	header += `on \`${ metadata.buildServerBranch }\` (built from \`${ metadata.builtFrom }\`) |\n\n`;

	if ( ! metadata.exactMatch ) {
		header += '> [!WARNING]\n';
		header += `> WordPress/WordPress does not contain a build of \`${ svnLabel }\`. The closest earlier build was used, `;
		header += `so changes made after \`${ metadata.builtFrom }\` also appear below.\n\n`;
	}

	if ( metadata.modifiedTrackedFiles.length ) {
		header += '> [!WARNING]\n> The build script modified these version-controlled files:\n>\n';
		header += metadata.modifiedTrackedFiles.map( ( file ) => `> - \`${ file }\`` ).join( '\n' ) + '\n\n';
	}

	if ( files.length === 0 ) {
		return `${ header }✅ The \`build\` directory is identical to WordPress/WordPress.\n`;
	}

	header += `**${ files.length } ${ files.length === 1 ? 'file differs' : 'files differ' }:** `;
	header += [ ...counts ]
		.filter( ( [ , count ] ) => count > 0 )
		.map( ( [ status, count ] ) => `${ count } ${ status.toLowerCase() }` )
		.join( ', ' ) + '.\n\n';
	header += '- **Added** files only exist in the `build` directory.\n';
	header += '- **Removed** files only exist in WordPress/WordPress. The build server does not always delete files that are ';
	header += 'no longer part of the build, so these may be stale files rather than real differences.\n\n';

	const footer = RUN_URL ? `\n[Download the complete comparison from the workflow run](${ RUN_URL }).\n` : '';
	let budget = maxLength - header.length - footer.length;

	// The list of files. Room is left for the truncation notice.
	let table = '### Files\n\n| Status | File | Lines |\n| --- | --- | --- |\n';
	let listed = 0;
	for ( const file of files ) {
		const row = `| ${ file.status } | <code>${ escapeHtml( file.name ) }</code> | ${ file.lines } |\n`;
		if ( table.length + row.length + 200 > budget ) {
			break;
		}
		table += row;
		listed++;
	}
	if ( listed < files.length ) {
		table += `\n_${ files.length - listed } more files are not listed._\n`;
	}
	table += '\n';
	budget -= table.length;

	// The full diff, truncated at a line boundary when needed.
	let diffSection = '';
	const fence = fenceFor( diff );
	const wrapperLength = 200 + fence.length * 2;
	if ( budget > wrapperLength + 1000 ) {
		let content = diff;
		let note = '';
		if ( content.length > budget - wrapperLength ) {
			content = content.slice( 0, content.lastIndexOf( '\n', budget - wrapperLength ) );
			note = '\n⚠️ The diff is too large to display in full.\n';
		}
		diffSection = `<details>\n<summary>Full diff</summary>\n\n${ fence }diff\n${ content }\n${ fence }\n${ note }\n</details>\n`;
	}

	return header + table + diffSection + footer;
}

fs.writeFileSync( OUTPUT_FILE, buildReport( Number( MAX_LENGTH ) ) );
fs.writeFileSync( `${ OUTPUT_FILE }.count`, String( files.length ) );
