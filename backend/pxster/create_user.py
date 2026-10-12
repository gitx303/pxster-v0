"""Create an initial workspace user without opening public registration."""
import getpass
from .api import Credentials
from .models import Session, User
from .security import passwords

if __name__ == "__main__":
    values = Credentials(email=input("Email: ").strip(), username=input("Username (optional): ").strip() or None, password=getpass.getpass("Password (12+ characters): "))
    with Session() as db:
        db.add(User(email=values.email.lower(), username=values.username.lower() if values.username else None, password_hash=passwords.hash(values.password)))
        db.commit()
    print("Workspace user created.")
