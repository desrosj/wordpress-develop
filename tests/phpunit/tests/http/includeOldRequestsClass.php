<?php

/**
 * Tests that the old Requests class is included
 * for plugins or themes that still use it.
 *
 * @group http
 */
class Tests_HTTP_IncludeOldRequestsClass extends WP_UnitTestCase {

	/**
	 * @ticket 57341
	 *
	 * @coversNothing
	 */
	public function test_should_include_old_requests_class() {
		// Note: $this->expectDeprecation() is deprecated and will be removed in PHPUnit 10.
		$deprecations = array();
		set_error_handler(
			static function ( int $errno, string $errstr ) use ( &$deprecations ) {
				$deprecations[] = compact( 'errno', 'errstr' );
				return true;
			},
			E_USER_DEPRECATED
		);

		try {
			// Referencing the class name triggers the autoloader, which is what raises the deprecation notice.
			class_exists( 'Requests' );
		} finally {
			restore_error_handler();
		}

		$this->assertCount( 1, $deprecations, 'Expected one deprecation notice.' );
		$this->assertStringContainsString( 'The PSR-0 `Requests_...` class names in the Requests library are deprecated.', $deprecations[0]['errstr'] );
	}
}
