from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0009_document_owner_created_at_indexes'),
    ]

    operations = [
        # Folder list query: WHERE owner_id=? AND is_archived=?
        # (owner FK index exists but doesn't cover the is_archived filter)
        migrations.AddIndex(
            model_name='folder',
            index=models.Index(
                fields=['owner', 'is_archived'],
                name='folder_owner_archived_idx',
            ),
        ),

        # TeamJoinRequest: WHERE user_id=? AND status='pending'
        # (unique_together covers (user, team) but not (user, status))
        migrations.AddIndex(
            model_name='teamjoinrequest',
            index=models.Index(
                fields=['user', 'status'],
                name='joinreq_user_status_idx',
            ),
        ),

        # TeamJoinRequest: WHERE team_id=? AND status='pending'  (team-leader view)
        migrations.AddIndex(
            model_name='teamjoinrequest',
            index=models.Index(
                fields=['team', 'status'],
                name='joinreq_team_status_idx',
            ),
        ),

        # CreditRequest: WHERE user_id=? AND status='pending'
        # (checked in multiple places with .exists() and .first())
        migrations.AddIndex(
            model_name='creditrequest',
            index=models.Index(
                fields=['user', 'status'],
                name='creditreq_user_status_idx',
            ),
        ),

        # CreditTransaction: WHERE user_id=? ORDER BY created_at DESC LIMIT 50
        # Lets Postgres satisfy the filter + sort in one index scan, no sort step
        migrations.AddIndex(
            model_name='credittransaction',
            index=models.Index(
                fields=['user', '-created_at'],
                name='credittx_user_created_idx',
            ),
        ),
    ]
