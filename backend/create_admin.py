import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'property_brief.settings')
django.setup()

from documents.models import User
from django.contrib.auth.hashers import make_password

username = os.environ.get('ADMIN_USERNAME', 'swong')
password = os.environ.get('ADMIN_PASSWORD', 'test123')

if not User.objects.filter(username=username).exists():
    User.objects.create(
        username=username,
        password=make_password(password),
        email='',
        role='admin',
        is_superuser=True,
        is_staff=True,
        is_active=True,
    )
    print(f"Admin user '{username}' created.")
else:
    print(f"Admin user '{username}' already exists.")
