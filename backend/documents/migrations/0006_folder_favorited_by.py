from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0005_add_clerk_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='folder',
            name='favorited_by',
            field=models.ManyToManyField(blank=True, related_name='favorite_folders', to=settings.AUTH_USER_MODEL),
        ),
    ]
