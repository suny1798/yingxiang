from alembic import context
from app.core import Settings
from app.db import Database
from app.models import metadata

config = context.config
settings = config.attributes.get("settings") or Settings.load()
db = Database(settings.database, settings.journal_mode, initialize=True)
try:
    with db.engine.connect() as connection:
        # PRAGMA journal_mode 不能位于事务内；只由显式运维迁移设置。
        raw = connection.connection.driver_connection
        raw.execute(f"PRAGMA journal_mode={settings.journal_mode}")
        context.configure(connection=connection, target_metadata=metadata, render_as_batch=True, transactional_ddl=True)
        with context.begin_transaction():
            context.run_migrations()
finally:
    db.close()
