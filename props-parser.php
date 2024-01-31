<?php

/**
 * Script to parse props from a git log.
 *
 * 1. Have a git clone
 * 2. Run a `git log` an pipe the ouput into a `commits.log` file. See below for examples.
 * 3. Run this script `php props-parser.php`
 * 3.1 `php props-parser.php -s|--stats` to print only stats for contributors (default)
 * 3.2 `php props-parser.php -s=combined|--stats=combined` to print stats for contributors and committers
 * 3.3 `php props-parser.php -s=committer|--stats=committer` to print stats only for committers
 * 3.4 `php props-parser.php -s --with-names` to include display names of users
 * 3.5 `php props-parser.php -p|--post` to print HTML list for release post
 * 3.6 `php props-parser.php -a|--api` to print list for use in credits API
 */

// git log --after="2015-08-18" --before="2015-12-05"  -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.log
// git log --after="2014-10-27"  -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.log
// git log --after="2014-09-05"  -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.log
// git log --after="2015-01-01" --before ="2016-01-01"  -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.meta.log
// git log --after="2014-01-01" --before ="2015-01-01"  -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.meta.log
// git log --after="2014-01-01" --before ="2015-01-01" --pretty=format:"%ce %n%n %B" > ../commits.meta.log
// git log --after="2015-12-06" --before ="2016-04-12" -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.log
// git log --after="2016-04-12" --before ="2016-08-16" -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.log
// git log --after="2016-08-17" --before ="2016-09-07" -i --grep props --pretty=format:"%ce %n%n %B" > ../commits.log
// git log --after="2016-08-17" --before ="2016-12-05" -i --grep "props" --pretty=format:"%ce %n%n %B" > ../commits.log
// 4.7.1: git log --after="2016-12-11" --before ="2017-01-11" -i --grep "props" --pretty=format:"%ce %n%n %B" > ../commits.log
// 4.7.3: git log --after="2017-01-25" --before ="2017-03-06" -i --pretty=format:"%ce %n%n %B" > ../commits.log
// 4.7.4: git log --after="2016-12-11" --before ="2017-04-20" -i --pretty=format:"%ce %n%n %B" > ../commits.log
// git log --after="2015-12-31" --before ="2017-03-06" --pretty=format:"%ce %n%n %B" > ../commits.meta.log
// git log --after="2016-12-05" --before ="2017-06-09" -i --grep "props" --pretty=format:"%ce %n%n %B" > ../commits.log
// 4.9.6: git log --after="2018-05-06" --before ="2018-08-02" -i --pretty=format:"%ce %n%n %B" > ../commits.log
// 5.0.3: git log --after="2018-12-18" --before ="2019-01-01" -i --pretty=format:"%ce %n%n %B" > ../commits.log
$log = file_get_contents( __DIR__ . '/after-6.4.log' );

$options = getopt( 's::pa', [ 'stats::', 'post', 'api', 'with-names' ] );

$output = 'stats';
if ( isset( $options['s'] ) || isset( $options['stats'] ) ) {
	if ( 'combined' === $options['s'] || 'combined' === $options['stats'] ) {
		$output = 'stats-combined';
	} elseif ( 'committer' === $options['s'] || 'committer' === $options['stats'] ) {
		$output = 'stats-committer';
	}
} elseif ( isset( $options['p'] ) || isset( $options['post'] ) ) {
	$output = 'html';
} elseif ( isset( $options['a'] ) || isset( $options['api'] ) ) {
	$output = 'api';
}

$with_names = ( isset( $options['with-names'] ) );

$committers = [];
preg_match_all( '/^.*(@git.wordpress.org).*$/im', $log, $matches_committers );
foreach ( $matches_committers[0] as $committer ) {
	list( $username, $_ ) = explode( '@', $committer );

	if ( false !== strpos( $username, '<' ) ) {
		$username = substr( $username, strpos( $username, '<' ) + 1 );
	}

	if ( ! isset( $committers[ $username ] ) ) {
		$committers[ $username ] = 0;
	}
	$committers[ $username ] += 1;

}

// For committer stats
if ( 'stats-committer' === $output ) {
	arsort( $committers );

	foreach ( $committers as $name => $count ) {
		printf( "%s,%d\n", $name, $count );
	}

	printf( "\nTotal: %d\n", count( $committers ) );

	echo "\n\n";
	exit;
}

// Parse the log and get all the props.

$missing_props = []; // Fill with missed props.

$contributors = [];
$combined     = $committers;

foreach ( $missing_props as $user ) {
	if ( ! isset( $contributors[ $user ] ) ) {
		$contributors[ $user ] = 0;
	}
	$contributors[ $user ] += 1;

	if ( ! isset( $combined[ $user ] ) ) {
		$combined[ $user ] = 0;
	}
	$combined[ $user ] += 1;
}

preg_match_all( '/^.*(props).*$/im', $log, $matches_props );
foreach ( $matches_props[0] as $match ) {
	$match = str_replace(
		[
			' fo helping to diagnose this issue.', // r38461
			' for reporting and testing.', // r38473
			' for reporting and testing this.', // r38427
			' for testing.', // r38497
			' for copy.', // r38574
			' for an iterative patch', // r39141
			' for feedback', // r39141
			': WordPress Thought Leadership Triumvirate', // r38582
			' (for the detailed bug report)', // r39682
			' (https://meta.trac.wordpress.org/ticket/1524#comment:57)', //r2536-meta
			'. General props for the About page:', //r40841
			'Props Italian polyglots team.', // r40812
			', suggestions, and insults where appropriate.', // r41701
			', who is supposed to be on sabbatical right now.', // r41829
			', and the infinite stack of bikesheds that WordPress is balanced upon.', // r41843
			'* Pass all of a gallery widget\'s instance props to the gallery media frame, not just the ones that core supports.', // r41951
			' for review', // r42445
			' all PHPCompatibilityWP and PHPCompatibility contributors.', // r46290
		],
		'',
		$match
	);
	$match = str_replace( ' ', ' ', $match );
	$parts = preg_split( '/ /', $match );

	$next_match_is_user = false;
	foreach ( $parts as $key => &$part ) {
		if ( preg_match( '/^props/i', $part ) ) {
			$next_match_is_user = true;
			continue;
		}

		if ( preg_match( '/^(fixes|see|closes)\b/i', trim( $part ) ) ) {
			$next_match_is_user = false;
			continue;
		}

		// Props jliman for the initial patch.
		// Props ocean90 for review.
		// props morganestes, voldemortensen, niallkennedy (for patching on the previous AP style).
		if ( preg_match( '/^\(?for$/i', $part ) ) {
			$next_match_is_user = false;
			continue;
		}

		// Remove @
		$part = preg_replace( '/^@/', '', $part );

		// et alii, r32440
		if ( preg_match( '/et/i', $part ) && preg_match( '/alii/i', $parts[ $key + 1 ] ) ) {
			unset( $parts[ $key ], $parts[ $key + 1 ] );
			continue;
		}

		// props on individual test classes., r35250
		if ( preg_match( '/on/i', $part ) && preg_match( '/individual/i', $parts[ $key + 1 ] ) ) {
			unset( $parts[ $key ], $parts[ $key + 1 ], $parts[ $key + 2 ], $parts[ $key + 3 ] );
			continue;
		}

		// props that will always have differing internal IDs, so strict comparison won't work., r34766
		if ( preg_match( '/that/i', $part ) && preg_match( '/will/i', $parts[ $key + 1 ] ) ) {
			for ( $i = 0; $i < 12; $i++ ) {
				unset( $parts[ $key + $i ] );
			}
			continue;
		}

		// who again outdid themselves
		if ( preg_match( '/who/i', $part ) && preg_match( '/again/i', $parts[ $key + 1 ] ) ) {
			for ( $i = 0; $i < 4; $i++ ) {
				unset( $parts[ $key + $i ] );
			}
			continue;
		}

		// props on `WP_User` to vars before passing them to `wp_xmlrpc_server::escape()` ,r34561
		if ( preg_match( '/on/i', $part ) && preg_match( '/`WP_User`/i', $parts[ $key + 1 ] ) ) {
			for ( $i = 0; $i < 9; $i++ ) {
				unset( $parts[ $key + $i ] );
			}
			continue;
		}

		// Usernames with spaces
		if ( preg_match( '/Blair/i', $part ) && preg_match( '/jersyer/i', $parts[ $key + 1 ] ) ) {
			$part = 'Blair jersyer';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Chaos/i', $part ) && preg_match( '/Engine/i', $parts[ $key + 1 ] ) ) {
			$part = 'Chaos Engine';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/colorful/i', $part ) && preg_match( '/tones/i', $parts[ $key + 1 ] ) ) {
			$part = 'colorful tones';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Craig/i', $part ) && preg_match( '/Ralston/i', $parts[ $key + 1 ] ) ) {
			$part = 'Craig Ralston';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Dhaval/i', $part ) && preg_match( '/Parekh/i', $parts[ $key + 1 ] ) ) {
			$part = 'Dhaval Parekh';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/ENDif/i', $part ) && preg_match( '/Media/i', $parts[ $key + 1 ] ) ) {
			$part = 'ENDif Media';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Frank/i', $part ) && preg_match( '/Klein/i', $parts[ $key + 1 ] ) ) {
			$part = 'Frank Klein';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Harry/i', $part ) && preg_match( '/Milatz/i', $parts[ $key + 1 ] ) ) {
			$part = 'Harry Milatz';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Hristo/i', $part ) && preg_match( '/Sg/i', $parts[ $key + 1 ] ) ) {
			$part = 'Hristo Sg';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Jaydeep/i', $part ) && preg_match( '/Rami/i', $parts[ $key + 1 ] ) ) {
			$part = 'Jaydeep Rami';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Michael/i', $part ) && preg_match( '/Arestad/i', $parts[ $key + 1 ] ) ) {
			$part = 'michaelarestad';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Ninos/i', $part ) && preg_match( '/Ego/i', $parts[ $key + 1 ] ) ) {
			$part = 'Ninos Ego';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/nitin/i', $part ) && preg_match( '/kevadiya/i', $parts[ $key + 1 ] ) ) {
			$part = 'nitin kevadiya';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/ramon/i', $part ) && preg_match( '/fincken/i', $parts[ $key + 1 ] ) ) {
			$part = 'ramon fincken';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Ravindra/i', $part ) && preg_match( '/Pal/i', $parts[ $key + 1 ] ) && preg_match( '/Singh/i', $parts[ $key + 2 ] ) ) {
			$part = 'Ravindra Pal Singh';
			unset( $parts[ $key + 1 ], $parts[ $key + 2 ] );
		}

		if ( preg_match( '/Samantha/i', $part ) && preg_match( '/Miller./i', $parts[ $key + 1 ] ) ) {
			$part = 'Samantha Miller.';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Shital/i', $part ) && preg_match( '/Patel/i', $parts[ $key + 1 ] ) ) {
			$part = 'Shital Patel';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Thomas/i', $part ) && preg_match( '/Vitale/i', $parts[ $key + 1 ] ) ) {
			$part = 'Thomas Vitale';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/TV/i', $part ) && preg_match( '/productions/i', $parts[ $key + 1 ] ) ) {
			$part = 'TV productions';
			unset( $parts[ $key + 1 ] );
		}

		if ( preg_match( '/Yorick/i', $part ) && preg_match( '/Koster/i', $parts[ $key + 1 ] ) ) {
			$part = 'Yorick Koster';
			unset( $parts[ $key + 1 ] );
		}

		if ( $next_match_is_user ) {
			$part = trim( $part );
			$part = trim( $part, "\xC2\xA0\xE2\x80\x82" ); // no-break space + en space
			$part = trim( $part, "\t,." );
			if ( ! $part ) {
				continue;
			}

			// Blacklist
			if ( in_array( $part, array(
				'`public`', // r31078
				'&',
				'and',
				'Team', // r31975
				'Gandalf', // r31975
				'#40850', // r40923
			) ) ) {
				continue;
			}

			// Typos
			if ( '#12kingkool68' === $part ) {
				$part = 'kingkool68';
			} elseif ( '_duck' === $part ) {
				$part = 'duck_'; // r34201
			} elseif ( 'aaronjorbin' === $part ) {
				$part = 'jorbin';
			} elseif ( 'aazaozz' === $part ) {
				$part = 'azaozz';
			} elseif ( 'afercis' === $part || 'aferica' === $part || 'ajercia' === $part ) {
				$part = 'afercia';
			} elseif ( 'afergen' === $part ) {
				$part = 'afragen';
			} elseif ( 'andersnoren' === $part ) {
				$part = 'anlino';
			} elseif ( 'ankit.gade' === $part || 'ankitgadertcampcom' === $part ) {
				$part = 'ankit.gade@rtcamp.com';
			} elseif ( 'aocean90' === $part ) {
				$part = 'ocean90';
			} elseif ( 'bappidgreat' === $part ) {
				$part = 'bappi.d.great';
			} elseif ( 'boone' === $part ) {
				$part = 'boonebgorges';
			} elseif ( 'brentjett' === $part ) {
				$part = 'brentjettgmailcom';
			} elseif ( 'byalextran' === $part ) {
				$part = 'alextran';
			} elseif ( 'celloexpessions' === $part ) {
				$part = 'celloexpressions';
			} elseif ( 'chouby' === $part ) {
				$part = 'Chouby';
			} elseif ( 'chrisvendiadvertisingcom' === $part ) {
				$part = 'chris@vendiadvertising.com';
			} elseif ( 'Clorith' === $part ) {
				$part = 'clorith';
			} elseif ( 'coliff' === $part ) {
				$part = 'lovememore';
			} elseif ( 'colorful-tones' === $part ) {
				$part = 'colorful tones';
			} elseif ( 'craig-ralston' === $part ) {
				$part = 'Craig Ralston';
			} elseif ( 'daniel-koskinen' === $part ) {
				$part = 'Daniel Koskinen';
			} elseif ( 'davidbinda' === $part ) {
				$part = 'david.binda';
			} elseif ( 'derosj' === $part ) {
				$part = 'desrosj';
			} elseif ( 'dingo-d' === $part ) {
				$part = 'dingo_d';
			} elseif ( 'drebbitsweb' === $part ) {
				$part = 'drebbits.web';
			} elseif ( 'dshanke' === $part ) {
				$part = 'dshanske';
			} elseif ( 'enejb' === $part ) {
				$part = 'enej';
			} elseif ( 'ericandrewlewis' === $part ) {
				$part = 'ericlewis';
			} elseif ( 'flixos' === $part ) {
				$part = 'flixos90'; // r38086
			} elseif ( 'frank-klein' === $part ) {
				$part = 'Frank Klein';
			} elseif ( 'gwinhlopez' === $part ) {
				$part = 'gwinh.lopez';
			} elseif ( 'H-Shredder' === $part ) {
				$part = 'DH-Shredder'; // r35561
			} elseif ( 'hellofromtonya' === $part ) {
				$part = 'hellofromTonya';
			} elseif ( 'iehsanir' === $part ) {
				$part = 'iEhsan.ir';
			} elseif ( 'ipm-frommen' === $part ) {
				$part = 'tfrommen';
			} elseif ( 'ipstenu' === $part ) {
				$part = 'Ipstenu';
			} elseif ( 'jasmussen' === $part ) {
				$part = 'joen';
			} elseif ( 'JeffPaul' === $part ) {
				$part = 'jeffpaul';
			} elseif ( 'jjj' === $part ) {
				$part = 'johnjamesjacoby';
			} elseif ( 'johbillion' === $part ) {
				$part = 'johnbillion';
			} elseif ( 'Jorbin' === $part ) {
				$part = 'jorbin';
			} elseif ( 'joyusly' === $part ) {
				$part = 'joyously';
			} elseif ( 'jrfnl' === $part ) {
				$part = 'jrf';
			} elseif ( 'jnylen' === $part ) {
				$part = 'jnylen0';
			} elseif ( 'justintadlock' === $part ) {
				$part = 'greenshady';
			} elseif ( 'karmatosed,hugobaeta' === $part ) {
				$part = 'karmatosed';
				$parts[] = 'hugobaeta';
			} elseif ( 'lance' === $part ) {
				$part = 'lancewillett';
			} elseif ( 'madalinungureanu' === $part ) {
				$part = 'madalin.ungureanu'; // r34951
			} elseif ( 'Mamaduka' === $part ) {
				$part = 'mamaduka';
			} elseif ( 'mattweibe' === $part ) {
				$part = 'mattwiebe';
			} elseif ( 'Michael-Arestad' === $part || 'michael-arestad' === $part ) {
				$part = 'michaelarestad';
			} elseif ( 'nicolealleyinteractivecom' === $part ) {
				$part = 'nicole@alleyinteractive.com';
			} elseif ( 'nrqsnchzm' === $part ) {
				$part = 'nrqsnchz';
			} elseif ( 'ntwb' === $part ) {
				$part = 'netweb';
			} elseif ( 'Otto42' === $part ) {
				$part = 'otto42';
			} elseif ( 'rachelbacker' === $part ) {
				$part = 'rachelbaker';
			} elseif ( 'raimy' === $part ) {
				$part = 'ramiy';
			} elseif ( 'Rarsr' === $part ) {
				$part = 'Rarst';
			} elseif ( 'rmmcue' === $part ) {
				$part = 'rmccue';
			} elseif ( 'ruudjoyo' === $part ) {
				$part = 'ruud@joyo';
			} elseif ( 'ryanmarkel' === $part ) {
				$part = 'markel';
			} elseif ( 'Samantha Miller' === $part ) {
				$part = 'Samantha Miller.';
			} elseif ( 'Sam' === $part || 'sams' === $part ) {
				$part = 'samuelsidler';
			} elseif ( 'sararosso' === $part ) {
				$part = 'rosso99';
			} elseif ( 'sc0ttclark' === $part ) {
				$part = 'sc0ttkclark'; // r34089
			} elseif ( 'SergeyBiryukov' === $part ) {
				$part = 'sergeybiryukov';
			} elseif ( 'sloisel' === $part ) {
				$part = 'csloisel';
			} elseif ( 'sunnnyratilal' === $part ) {
				$part = 'sunnyratilal'; // r33160
} elseif ( 'swissspdy' === $part || 'swisspidy' === $part || 'swisssipdy' === $part ) {
$part = 'swissspidy';
} elseif ( 'tanner-m' === $part ) {
				$part = 'tanner m';
			} elseif ( 'TimothyBlynJacobs5' === $part || 'timothyblynjacobs' === $part ) {
				$part = 'TimothyBlynJacobs';
			} elseif ( 'umeshnevase' === $part ) {
				$part = 'umesh.nevase';
			} elseif ( 'wen-solutions' === $part ) {
				$part = 'WEN Solutions';
			} elseif ( 'weston.ruter' === $part ) {
				$part = 'westonruter';
			} elseif ( 'wordpressorru' === $part ) {
				$part = 'WordPressor.ru';
				// Usernames with spaces
			} elseif ( 'Ankit' === $part || 'ankit-k-gupta' === $part || 'Ankit-K-Gupta' === $part ) {
				$part = 'Ankit K Gupta';
				unset( $parts[ $key + 1 ], $parts[ $key + 2 ] );
			} elseif ( 'F' === $part ) {
				$part = 'F J Kaiser';
				unset( $parts[ $key + 1 ], $parts[ $key + 2 ] );
			}

			// Name changes
			if ( 'DH-Shredder' === $part ) {
				$part = 'mikeschroder';
			} elseif ( 'jbpaul17' === $part ) {
				$part = 'jeffpaul';
			} elseif ( 'sebastienthivinfocom' === $part ) {
				$part = 'sebastienserre';
			}

			$_part = $part;

			if ( ! isset( $contributors[ $part ] ) ) {
				$contributors[ $part ] = 0;
			}
			$contributors[ $part ] += 1;

			if ( ! isset( $combined[ $part ] ) ) {
				$combined[ $part ] = 0;
			}
			$combined[ $part ] += 1;
		}
	}
}

// For stats
if ( 'stats' === $output ) {
	arsort( $contributors );

	foreach ( $contributors as $name => $count ) {
		if ( $with_names ) {
			$user         = get_user_by( 'slug', $name );
			$display_name = $user->display_name ?: $name;

			printf( "%d\t%s\t%s\n", $count, $display_name, $name );
		} else {
			printf( "%s,%d\n", $name, $count );
		}
	}

	printf( "\nTotal: %d\n", count( $contributors ) );

	echo "\n\n";
}

if ( 'stats-combined' === $output ) {
	arsort( $combined );

	foreach ( $combined as $name => $count ) {
		if ( $with_names ) {
			$user         = get_user_by( 'slug', $name );
			$display_name = $user->display_name ?: $name;

			printf( "%d\t%s\t%s\n", $count, $display_name, $name );
		} else {
			printf( "%s,%d\n", $name, $count );
		}
	}

	printf( "\nTotal: %d\n", count( $combined ) );

	echo "\n\n";
}

// For release post
if ( 'html' === $output ) {
	$html = [];
	foreach ( $combined as $name => $count ) {
		$user         = get_user_by( 'slug', $name );
		$display_name = $user->display_name ?: $name;

		$html[ $display_name ] = sprintf(
			'<a href="https://profiles.wordpress.org/%s/">%s</a>',
			$name,
			$display_name
		);
	}

	uksort( $html, function( $a, $b ) {
		return strnatcasecmp( $a,$b );
	} );

	echo wp_sprintf( '%l.', $html );
	echo "\n\n";
}

// For credits API
if ( 'api' === $output ) {
	ksort( $combined );
	foreach ( $combined as $name => $count ) {
		printf( "'%s',\n", $name );
	}
}
