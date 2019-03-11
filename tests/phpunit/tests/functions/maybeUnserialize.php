<?php

/**
 * @group functions.php
 */
class Tests_Functions_MaybeUnserialize extends WP_UnitTestCase {

	/**
	 * Strings should unserialize.
	 *
	 * @ticket 45895
	 */
	public function test_unserialize_string() {
		$string = 'Wapuu';
		$input  = serialize( $string );

		$this->assertEquals( $string, maybe_unserialize( $input ) );
	}

	/**
	 * Arrays should unserialize.
	 *
	 * @ticket 45895
	 */
	public function test_unserialize_array() {
		$array = array( 'wapuu' );
		$input = serialize( $array );

		$this->assertEquals( $array, maybe_unserialize( $input ) );
	}

	/**
	 * Objects should unserialize.
	 *
	 * @ticket 45895
	 */
	public function test_unserialize_object() {
		$object       = new stdClass();
		$object->name = 'Wapuu';
		$input        = serialize( $object );

		$this->assertEquals( $object, maybe_unserialize( $input ) );
	}

	/**
	 * Exceptions should be handled correctly.
	 * 
	 * @ticket 45895
	 */
	public function test_unserialize_exception_handled() {
		// This string raises an exception when run through unserialize() on PHP 7.2+.
		$input = 'O:16:"SimpleXMLElement":0:{}';

		// Ensure that we just get the original input returned.
		$this->assertEquals( $input, maybe_unserialize( $input ) );
	}
}
