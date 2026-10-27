-- Down cho 0017_user_ownership: không đảo được (dữ liệu workspace đã xoá, không suy ra được chủ sở hữu).
-- Rollback = reset DB (docs/development-setup.md, mục Reset DB dev) + checkout bản code trước khi bỏ workspace.
DO $$ BEGIN
  RAISE EXCEPTION 'không rollback được 0017_user_ownership — reset DB + checkout bản cũ';
END $$;
