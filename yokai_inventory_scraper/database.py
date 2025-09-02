import os
from sqlalchemy import create_engine, Column, Integer, String, Boolean, Text, DateTime, ForeignKey, Table, text
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from sqlalchemy.pool import NullPool
from datetime import datetime
import pytz
from dotenv import load_dotenv

# --- Database Configuration ---
# Render provides the DATABASE_URL environment variable
# For local development, we can fall back to a local SQLite database
DATABASE_URL = os.getenv("DATABASE_URL")

# If DATABASE_URL is provided (i.e., on Render), use PostgreSQL.
# Otherwise, use a local SQLite database.
if DATABASE_URL:
    # Render's PostgreSQL setup might require a specific dialect name.
    # The URL from Render should start with 'postgresql://'
    # We add `sslmode=require` to enforce a secure connection, which can prevent
    # intermittent SSL-related errors on cloud platforms.
    engine = create_engine(DATABASE_URL, connect_args={"sslmode": "require"})
else:
    # For local development and testing, use SQLite.
    # NullPool is recommended for SQLite to avoid issues with thread safety in web apps.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(script_dir, "inventory.db")
    engine = create_engine(f"sqlite:///{db_path}", poolclass=NullPool)

# --- Session Management ---
# The Session is the primary interface for all database operations.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# --- Base Model ---
# All our data models will inherit from this class.
Base = declarative_base()


# --- Data Models (Tables) ---

class Warehouse(Base):
    """
    代表倉庫的庫存資料。
    每次上傳 Excel 文件時只會更新同名倉庫的數據。
    """
    __tablename__ = "warehouse"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    warehouse_name = Column(String, nullable=False, index=True)
    product_name = Column(String, nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(pytz.timezone('Asia/Taipei')))
    
    def to_dict(self):
        return {
            'warehouse_name': self.warehouse_name,
            'product_name': self.product_name,
            'quantity': self.quantity,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

class Inventory(Base):
    """
    Represents the inventory of a product in a specific machine.
    This table will be completely cleared and repopulated on each scrape.
    """
    __tablename__ = "inventory"

    # A unique ID for each row
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Composite key parts from the original design
    store = Column(String, nullable=False, index=True)
    machine_id = Column(String, nullable=False, index=True)
    product_name = Column(String, nullable=False, index=True)
    
    quantity = Column(Integer, nullable=False)
    last_updated = Column(String) # e.g., "2025-02-13 23:46:54 (Asia/Taipei)"
    
    # The timestamp when this specific record was scraped and processed
    process_time = Column(DateTime(timezone=True), nullable=False)

    def to_dict(self):
        """Converts the object to a dictionary."""
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}


class Store(Base):
    """
    Represents custom, user-editable data for a specific store/machine combination.
    This data is PERSISTENT and will NOT be cleared on each scrape.
    """
    __tablename__ = "stores"

    # The unique key for a store, e.g., "TW Lion HQ 1.0-551"
    store_key = Column(String, primary_key=True, index=True)
    
    address = Column(Text, default="")
    note = Column(Text, default="")
    manual_sales = Column(Integer, default=0)
    is_hidden = Column(Boolean, default=False)
    
    # Timestamps for tracking changes
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(pytz.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(pytz.utc), onupdate=lambda: datetime.now(pytz.utc))

    transactions = relationship("Transaction", back_populates="store")

    def to_dict(self):
        """Converts the object to a dictionary."""
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}


# --- Association table: users <-> stores (many-to-many)
user_stores = Table(
    'user_stores',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('store_key', String, ForeignKey('stores.store_key'), primary_key=True)
)


class User(Base):
    """
    Represents an application user (franchisee). Passwords are stored as hashes.
    """
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, default='')
    email = Column(String, nullable=True, default='')
    low_inventory_threshold = Column(Integer, nullable=True, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(pytz.utc))

    # Many-to-many relationship to stores
    stores = relationship('Store', secondary=user_stores, backref='users')

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'display_name': self.display_name,
            'email': self.email,
            'low_inventory_threshold': self.low_inventory_threshold,
            'stores': [s.store_key for s in self.stores],
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Transaction(Base):
    __tablename__ = 'transactions'
    id = Column(Integer, primary_key=True)
    store_key = Column(String, ForeignKey('stores.store_key'), nullable=False, index=True)
    transaction_time = Column(DateTime, nullable=False, index=True)
    amount = Column(Integer, nullable=False)
    product_name = Column(String, nullable=False)
    payment_type = Column(String, nullable=False)

    store = relationship("Store", back_populates="transactions")


class UpdateLog(Base):
    """
    Stores a record of each scraper run, whether it was for inventory or sales.
    """
    __tablename__ = 'update_logs'
    id = Column(Integer, primary_key=True, autoincrement=True)
    scraper_type = Column(String, nullable=False, index=True)  # 'inventory' or 'sales'
    ran_at = Column(DateTime(timezone=True), default=lambda: datetime.now(pytz.utc))
    status = Column(String, nullable=False)  # 'success' or 'error'
    details = Column(Text, nullable=True)  # e.g., 'Updated 62 items' or error message


class NotificationSent(Base):
    """
    Tracks notifications sent to users for specific stores.
    Used to enforce "one notification per store per day" and global daily limits.
    """
    __tablename__ = 'notification_sent'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    store_key = Column(String, nullable=False, index=True)
    sent_at = Column(DateTime(timezone=True), default=lambda: datetime.now(pytz.utc))

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'store_key': self.store_key,
            'sent_at': self.sent_at.isoformat() if self.sent_at else None
        }


def init_db():
    """
    Creates all the tables in the database.
    This function should be called once when the application starts.
    """
    print("Initializing database...")
    try:
        Base.metadata.create_all(bind=engine)
        print("Database tables created successfully (if they didn't exist).")

        # Runtime migration: ensure `email` column exists on users table for older DBs.
        try:
            conn = engine.connect()
            # PRAGMA table_info returns rows where index 1 is the column name
            existing = [r[1] for r in conn.execute(text("PRAGMA table_info('users')")).fetchall()]
            if 'email' not in existing:
                # Add the email column with a nullable text type
                conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
                print("Migrated users table: added 'email' column.")
            if 'low_inventory_threshold' not in existing:
                # Add low inventory threshold integer column for user notification settings
                conn.execute(text("ALTER TABLE users ADD COLUMN low_inventory_threshold INTEGER DEFAULT 0"))
                print("Migrated users table: added 'low_inventory_threshold' column.")
            conn.close()
        except Exception as me:
            print(f"Runtime migration check failed: {me}")

    except Exception as e:
        print(f"An error occurred during database initialization: {e}")


class Feedback(Base):
    """
    Stores anonymous feedback from users of the restock SOP UI.
    We keep a client-generated user_id so we can detect repeat submissions
    without tying feedback to a known identity.
    """
    __tablename__ = 'feedback'
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    rating = Column(Integer, nullable=False)  # 1..5
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(pytz.utc))

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}

# --- Convenience function for getting a DB session ---
def get_db():
    """
    Generator function to get a database session.
    Ensures the session is properly closed after use.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 