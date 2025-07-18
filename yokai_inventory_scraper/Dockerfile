# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies for Chrome using Google's official new repository setup
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Download and install Google Chrome
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb

# Copy the requirements file into the container
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# - Gunicorn is our production WSGI server.
# - psycopg2-binary for PostgreSQL.
# - beautifulsoup4 if needed for parsing HTML.
# - pandas for data manipulation.
# - openpyxl for Excel file support.
# - lxml for faster XML/HTML parsing.
# - python-dotenv to load environment variables from .env files.
# - selenium for web scraping.
# - schedule for task scheduling.
# - SQLAlchemy for database ORM.
# - Flask-Cors for handling Cross-Origin Resource Sharing.
RUN pip install --no-cache-dir gunicorn psycopg2-binary beautifulsoup4 pandas openpyxl lxml python-dotenv selenium schedule SQLAlchemy Flask-Cors

# Copy the rest of the application code
COPY . .

# Run database migrations/initializations
# This command ensures the database is ready before the server starts.
RUN python -c "from database import init_db; init_db()"

# Define the command to run the application
# Use gunicorn for production, and bind to the port specified by Render's $PORT env var
# We use --workers 1 to ensure the scheduler only runs in one process.
CMD ["gunicorn", "--bind", "0.0.0.0:$PORT", "--workers", "1", "server:app"] 