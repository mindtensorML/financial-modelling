// Each entry runs once, in order; PRAGMA user_version records how many have run.
// Append new migrations to the end. Never edit one that has shipped.
export const migrations: string[] = [
  `
  CREATE TABLE households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    rev INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX users_household ON users(household_id);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE stores (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL
  );
  CREATE INDEX stores_sync ON stores(household_id, rev);

  CREATE TABLE store_aliases (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    alias_key TEXT NOT NULL,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (household_id, alias_key)
  );

  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    category TEXT NOT NULL,
    predicted_store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
    prediction_confidence REAL,
    prediction_reason TEXT,
    purchase_count INTEGER NOT NULL DEFAULT 0,
    last_purchased_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL,
    UNIQUE (household_id, name_key)
  );
  CREATE INDEX products_sync ON products(household_id, rev);

  CREATE TABLE product_aliases (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    alias_key TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (household_id, alias_key)
  );

  CREATE TABLE list_items (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    note TEXT,
    category TEXT NOT NULL,
    store_id TEXT REFERENCES stores(id),
    store_source TEXT NOT NULL,
    store_reason TEXT,
    checked_at INTEGER,
    checked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    capture_id TEXT,
    merged_into TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL
  );
  CREATE INDEX list_items_sync ON list_items(household_id, rev);
  CREATE INDEX list_items_product ON list_items(household_id, product_id);

  CREATE TABLE captures (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    media TEXT NOT NULL,
    hint TEXT NOT NULL,
    status TEXT NOT NULL,
    mime_type TEXT,
    blob_key TEXT,
    byte_size INTEGER,
    file_name TEXT,
    text_input TEXT,
    transcript TEXT,
    extraction TEXT,
    engine TEXT,
    error TEXT,
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL
  );
  CREATE INDEX captures_sync ON captures(household_id, rev);
  CREATE INDEX captures_status ON captures(status);

  CREATE TABLE purchases (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id TEXT REFERENCES stores(id),
    purchased_at INTEGER NOT NULL,
    quantity REAL,
    unit TEXT,
    price_cents INTEGER,
    source TEXT NOT NULL,
    capture_id TEXT,
    list_item_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX purchases_product ON purchases(household_id, product_id, purchased_at);
  CREATE INDEX purchases_store ON purchases(household_id, store_id, purchased_at);
  CREATE INDEX purchases_item ON purchases(list_item_id);

  CREATE TABLE store_choices (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id TEXT NOT NULL REFERENCES stores(id),
    user_id TEXT,
    chosen_at INTEGER NOT NULL
  );
  CREATE INDEX store_choices_product ON store_choices(household_id, product_id, chosen_at);

  CREATE TABLE applied_ops (
    household_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (household_id, op_id)
  );
  CREATE INDEX applied_ops_time ON applied_ops(applied_at);
  `,
]
