-- Down cho 0016_drop_workspaces: không đảo được (dữ liệu workspace đã xoá, không suy ra được chủ sở hữu).
-- Rollback = reset DB (docs/development-setup.md, mục Reset DB dev) + checkout bản code trước khi bỏ workspace.
DO $$ BEGIN
  RAISE EXCEPTION 'không rollback được 0016_drop_workspaces — reset DB + checkout bản cũ';
END $$;
