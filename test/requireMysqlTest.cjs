if (!/^humaeli_test_[a-z0-9_]+$/.test(process.env.MYSQL_TEST_DATABASE || '')) {
  throw new Error('Set MYSQL_TEST_DATABASE=humaeli_test_<name> to run MySQL integration tests safely');
}
