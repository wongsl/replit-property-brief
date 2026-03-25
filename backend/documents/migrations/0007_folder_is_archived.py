from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0006_folder_favorited_by'),
    ]

    operations = [
        migrations.AddField(
            model_name='folder',
            name='is_archived',
            field=models.BooleanField(default=False),
        ),
    ]
