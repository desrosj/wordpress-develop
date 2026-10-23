<?php
/**
 * Test wp_user_settings().
 *
 * @group option
 * @group user
 * @covers ::wp_user_settings
 */
class Tests_Option_wpUserSettings extends WP_UnitTestCase {

	/**
	 * Tests that PHP 8.1 "passing null to non-nullable" deprecation notice
	 * is not thrown for the `$domain` parameter of setcookie() calls in the function.
	 *
	 * The notice that we should not see:
	 * `Deprecated: setcookie(): Passing null to parameter #5 ($domain) of type string is deprecated`.
	 *
	 * Note: This does not test the actual functioning of wp_user_settings().
	 * It just and only tests for/against the deprecation notice.
	 *
	 * @ticket 54914
	 */
	public function test_wp_user_settings_does_not_throw_deprecation_notice_for_setcookie() {
		set_current_screen( 'edit.php' );
		wp_set_current_user( self::factory()->user->create() );

		// Verify that the function's starting conditions are satisfied.
		$this->assertTrue( is_admin() );
		$this->assertGreaterThan( 0, get_current_user_id() );

		// `Cannot modify header information - headers already sent by...` from setcookie().
		// Note: $this->expectWarning() is deprecated and will be removed in PHPUnit 10.
		$warnings = array();
		set_error_handler(
			static function ( int $errno, string $errstr ) use ( &$warnings ) {
				$warnings[] = compact( 'errno', 'errstr' );
				return true;
			},
			E_WARNING
		);

		try {
			wp_user_settings();
		} finally {
			restore_error_handler();
		}

		// wp_user_settings() calls setcookie() twice.
		$this->assertCount( 2, $warnings, 'Expected two warnings.' );
	}
}
