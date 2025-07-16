import os
from sqlalchemy import create_engine, Column, Integer, String, Boolean, Text, DateTime, Date, Float
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool
import datetime
import pytz

# --- Database Configuration ---

# On Render, DATABASE_URL is provided. For local dev, we'll use SQLite.
DATABASE_URL = os.environ.get("DATABASE_URL")

# Render's DATABASE_URL starts with "postgres://", but SQLAlchemy needs "postgresql://"
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    # Use NullPool for serverless environments as recommended by SQLAlchemy
    engine = create_engine(DATABASE_URL, poolclass=NullPool)
else:
    # Fallback to a local SQLite database file
    print("DATABASE_URL not found, falling back to local SQLite database 'inventory.db'")
    engine = create_engine("sqlite:///inventory.db")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- ORM Models ---

class Inventory(Base):
    __tablename__ = 'inventory'
    
    id = Column(Integer, primary_key=True, index=True)
    store = Column(String, index=True, nullable=False)
    machine_id = Column(String, index=True, nullable=False)
    last_updated = Column(String)
    last_cleaned = Column(String)
    product_name = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    process_time = Column(DateTime, default=datetime.datetime.utcnow)
    store_key = Column(String, index=True, nullable=False)

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}

class Store(Base):
    """
    Represents custom, user-editable data for a specific store/machine combination.
    This data is PERSISTENT and will NOT be cleared on each scrape.
    """
    __tablename__ = "stores"
    
    store_key = Column(String, primary_key=True, index=True)
    address = Column(Text, default="")
    note = Column(Text, default="")
    manual_sales = Column(Integer, default=0)
    is_hidden = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(pytz.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(pytz.utc), onupdate=lambda: datetime.datetime.now(pytz.utc))

    def to_dict(self):
        """Converts the object to a dictionary."""
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}

class SalesData(Base):
    __tablename__ = 'sales_data'
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, index=True)
    shop_name = Column(String, nullable=False, index=True)
    product_name = Column(String, nullable=False)
    pay_type = Column(String)
    amount = Column(Float, nullable=False)

# --- Database Initialization and Session Management ---

def init_db():
    """
    Creates all database tables based on the models defined.
    This is safe to run on every application startup.
    """
    try:
        print("Initializing database tables...")
        Base.metadata.create_all(bind=engine)
        print("Database tables initialized successfully.")
    except Exception as e:
        print(f"An error occurred during database initialization: {e}")

def get_db():
    """
    Dependency for FastAPI routes to get a database session.
    Ensures the session is always closed after the request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 