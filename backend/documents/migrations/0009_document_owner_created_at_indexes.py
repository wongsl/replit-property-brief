from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0008_combinedanalysis_favorited_by'),
    ]

    operations = [
        # Composite index for the primary dashboard query:
        # WHERE owner_id = ? AND created_at >= ?
        migrations.AddIndex(
            model_name='document',
            index=models.Index(
                fields=['owner', '-created_at'],
                name='doc_owner_created_idx',
            ),
        ),
        # Composite index for the team-scope query:
        # WHERE team_id = ? AND is_private = false AND created_at >= ?
        migrations.AddIndex(
            model_name='document',
            index=models.Index(
                fields=['team', 'is_private', '-created_at'],
                name='doc_team_created_idx',
            ),
        ),
    ]
