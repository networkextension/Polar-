-- Reference snippet for first-time PostgreSQL setup.
-- Run as a superuser (e.g. `psql -U postgres` or `psql -U $(whoami) -d postgres`).
-- The application defaults expect db=ideamesh, user=ideamesh.

CREATE DATABASE ideamesh;
CREATE USER ideamesh WITH PASSWORD 'test123456';
GRANT ALL PRIVILEGES ON DATABASE ideamesh TO ideamesh;
ALTER DATABASE ideamesh OWNER TO ideamesh;
