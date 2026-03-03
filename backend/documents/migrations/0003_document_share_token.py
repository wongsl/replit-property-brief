from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0002_add_email_draft'),
    ]

    operations = [
        migrations.AddField(
            model_name='document',
            name='share_token',
            field=models.UUIDField(blank=True, null=True, unique=True),
        ),
    ]
