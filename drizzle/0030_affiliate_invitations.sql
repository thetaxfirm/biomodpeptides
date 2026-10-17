CREATE TABLE affiliate_invitations (
 email TEXT PRIMARY KEY COLLATE NOCASE, active INTEGER NOT NULL CHECK(active IN (0,1)), created INTEGER NOT NULL, updated INTEGER NOT NULL, actor TEXT NOT NULL
);
