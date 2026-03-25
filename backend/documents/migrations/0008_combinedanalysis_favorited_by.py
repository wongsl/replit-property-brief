from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0007_folder_is_archived'),
    ]

    operations = [
        migrations.AddField(
            model_name='combinedanalysis',
            name='favorited_by',
            field=models.ManyToManyField(blank=True, related_name='favorite_combined_analyses', to=settings.AUTH_USER_MODEL),
        ),
    ]
