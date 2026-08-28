import unittest
from tools.algora_patch_worker import PatchError, clean_diff, select_candidate


class CandidateTests(unittest.TestCase):
    def test_selects_only_verified_supported_candidate(self):
        report = {"source_of_truth":"GitHub API","algora_scraping":False,"candidates":[
            {"eligible":True,"language":"Rust","repository":"a/b","issue_number":1},
            {"eligible":True,"language":"TypeScript","repository":"a/c","issue_number":2}]}
        self.assertEqual(select_candidate(report)["issue_number"], 2)

    def test_rejects_untrusted_report(self):
        with self.assertRaises(PatchError):
            select_candidate({"source_of_truth":"Algora scrape","algora_scraping":True})


class DiffTests(unittest.TestCase):
    def test_accepts_bounded_diff(self):
        diff = "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n"
        self.assertEqual(clean_diff(diff), diff)

    def test_rejects_workflow_and_traversal(self):
        for path in (".github/workflows/pwn.yml", "../pwn"):
            diff=f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -0,0 +1 @@\n+x\n"
            with self.assertRaises(PatchError): clean_diff(diff)


if __name__ == "__main__": unittest.main()
