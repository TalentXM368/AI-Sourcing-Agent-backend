import unittest

from resume_jd_matcher import ResumeJDMatcher


class TestProductionHardening(unittest.TestCase):
    def setUp(self):
        self.matcher = ResumeJDMatcher()
        self.resumes = [
            {
                "id": "resume_1",
                "file_name": "candidate_one.pdf",
                "data": {
                    "full_name": "Alice Johnson",
                    "email": "alice@example.com",
                    "skills": ["python", "machine learning"],
                    "total_experience_years": 4,
                    "education": "Bachelor's degree",
                },
            }
        ]
        self.jd = {
            "required_skills": ["python"],
            "required_experience_years": 3,
            "education_requirement": "Bachelor's degree",
            "key_qualifications": [],
        }
        self.pinecone_matches = [{"resume_id": "resume_1", "score": 0.85}]

    def test_default_output_masks_pii(self):
        matches = self.matcher.match_resumes_to_jd(
            resumes_with_embeddings=self.resumes,
            jd=self.jd,
            jd_embedding=[],
            pinecone_matches=self.pinecone_matches,
            scoring_mode="hybrid",
            include_pii=False,
        )

        self.assertEqual(len(matches), 1)
        match = matches[0]
        self.assertIn("candidate_label", match)
        self.assertIn("candidate_email_masked", match)
        self.assertNotIn("candidate_name", match)
        self.assertNotIn("candidate_email", match)

    def test_include_pii_opt_in(self):
        matches = self.matcher.match_resumes_to_jd(
            resumes_with_embeddings=self.resumes,
            jd=self.jd,
            jd_embedding=[],
            pinecone_matches=self.pinecone_matches,
            scoring_mode="hybrid",
            include_pii=True,
        )

        self.assertEqual(len(matches), 1)
        match = matches[0]
        self.assertIn("candidate_name", match)
        self.assertIn("candidate_email", match)

    def test_hybrid_scoring_metadata_present(self):
        matches = self.matcher.match_resumes_to_jd(
            resumes_with_embeddings=self.resumes,
            jd=self.jd,
            jd_embedding=[],
            pinecone_matches=self.pinecone_matches,
            scoring_mode="hybrid",
            include_pii=False,
        )

        match = matches[0]
        self.assertEqual(match["scoring_mode"], "hybrid")
        self.assertIn("hybrid_penalty", match["score_breakdown"])

    def test_anonymization_helpers(self):
        self.assertEqual(self.matcher._anonymize_name("Alice Johnson"), "Candidate-AJ")
        self.assertEqual(self.matcher._anonymize_name(""), "Candidate")
        self.assertEqual(self.matcher._mask_email("alice@example.com"), "a***@example.com")
        self.assertEqual(self.matcher._mask_email(""), "N/A")


if __name__ == "__main__":
    unittest.main()
