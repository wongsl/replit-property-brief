import uuid
from django.test import TestCase
from django.contrib.auth.hashers import make_password
from rest_framework.test import APIClient
from .models import User, Document


def make_user(username='testuser', password='pass'):
    return User.objects.create(username=username, password=make_password(password), email=f'{username}@test.com')


def make_doc(owner, name='test.pdf', ai_analysis=None):
    return Document.objects.create(name=name, owner=owner, ai_analysis=ai_analysis)


SAMPLE_ANALYSIS = {
    'addressNumber': '123',
    'streetName': 'Main',
    'suffix': 'St',
    'city': 'Springfield',
    'county': 'Shelby',
    'zipcode': '12345',
    'document_type': 'Home Inspection Report',
    'inspection_date': '2026-01-01',
    'summary': {
        'Roof': {'condition': 'Good', 'issues': [], 'age': '5 years', 'recommendation': 'No action needed'},
        'Electrical': {'condition': 'Fair', 'issues': ['Outdated panel'], 'recommendation': 'Upgrade panel'},
    },
}


class ShareActionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_share_requires_authentication(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        unauthed = APIClient()
        res = unauthed.post(f'/api/documents/{doc.id}/share/')
        self.assertEqual(res.status_code, 403)

    def test_share_document_without_analysis_returns_400(self):
        doc = make_doc(self.user)
        res = self.client.post(f'/api/documents/{doc.id}/share/')
        self.assertEqual(res.status_code, 400)
        self.assertIn('error', res.data)

    def test_share_document_with_analysis_returns_token(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post(f'/api/documents/{doc.id}/share/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('share_token', res.data)
        token = res.data['share_token']
        # Token must be a valid UUID
        uuid.UUID(token)

    def test_share_generates_token_and_persists(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post(f'/api/documents/{doc.id}/share/')
        self.assertEqual(res.status_code, 200)
        doc.refresh_from_db()
        self.assertIsNotNone(doc.share_token)
        self.assertEqual(str(doc.share_token), res.data['share_token'])

    def test_share_is_idempotent(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        res1 = self.client.post(f'/api/documents/{doc.id}/share/')
        res2 = self.client.post(f'/api/documents/{doc.id}/share/')
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res1.data['share_token'], res2.data['share_token'])

    def test_cannot_share_another_users_document(self):
        other = make_user('other')
        doc = make_doc(other, ai_analysis=SAMPLE_ANALYSIS)
        res = self.client.post(f'/api/documents/{doc.id}/share/')
        self.assertEqual(res.status_code, 404)

    def test_share_token_returned_in_document_serializer(self):
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        self.client.post(f'/api/documents/{doc.id}/share/')
        res = self.client.get(f'/api/documents/{doc.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('share_token', res.data)
        self.assertIsNotNone(res.data['share_token'])


class ShareViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def test_share_view_returns_analysis_for_valid_token(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, name='report.pdf', ai_analysis=SAMPLE_ANALYSIS)
        doc.share_token = token
        doc.save(update_fields=['share_token'])

        res = self.client.get(f'/api/share/{token}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['name'], 'report.pdf')
        self.assertEqual(res.data['ai_analysis'], SAMPLE_ANALYSIS)

    def test_share_view_returns_404_for_unknown_token(self):
        token = uuid.uuid4()
        res = self.client.get(f'/api/share/{token}/')
        self.assertEqual(res.status_code, 404)

    def test_share_view_returns_404_for_malformed_token(self):
        res = self.client.get('/api/share/not-a-uuid/')
        self.assertEqual(res.status_code, 404)

    def test_share_view_does_not_require_authentication(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        doc.share_token = token
        doc.save(update_fields=['share_token'])

        unauthed = APIClient()
        res = unauthed.get(f'/api/share/{token}/')
        self.assertEqual(res.status_code, 200)

    def test_share_view_only_returns_safe_fields(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, ai_analysis=SAMPLE_ANALYSIS)
        doc.share_token = token
        doc.storage_path = '/secret/path/file.pdf'
        doc.save(update_fields=['share_token', 'storage_path'])

        res = self.client.get(f'/api/share/{token}/')
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('storage_path', res.data)
        self.assertNotIn('owner', res.data)
        self.assertNotIn('email_draft', res.data)
        self.assertIn('name', res.data)
        self.assertIn('ai_analysis', res.data)

    def test_share_view_returns_404_when_doc_has_no_analysis(self):
        token = uuid.uuid4()
        doc = make_doc(self.user, ai_analysis=None)
        doc.share_token = token
        doc.save(update_fields=['share_token'])

        res = self.client.get(f'/api/share/{token}/')
        self.assertEqual(res.status_code, 404)
