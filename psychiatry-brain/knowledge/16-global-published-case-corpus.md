# Global Published Psychiatry Case Corpus

## Purpose
The Psychiatry Study Brain should not depend on the trainee encountering a particular diagnosis at Helwan or any single hospital. It should maintain a large, diverse educational corpus built from public open-access psychiatry case reports and use those cases to create source-grounded, fictionalized teaching vignettes.

Initial milestone: **at least 1,000 indexed open-access psychiatric case-report records**. The corpus should continue to refresh with new cases while deduplicating stable publication IDs.

## Source policy
- Use official literature APIs rather than scraping arbitrary websites.
- Initial source: Europe PMC open-access records available in Europe PMC full text collections.
- Exclude preprints from the default clinical case corpus.
- Keep publication identifiers and license metadata for provenance.
- Do not ingest private EHRs, leaked records, social-media patient stories, or identifiable hospital records.
- Do not store author affiliations or patient identifiers as learning fields.
- Raw publication full text is not required for the initial corpus. Citation metadata plus the published abstract is sufficient for indexing and lazy educational transformation.
- A historical case report is evidence that a presentation occurred; it is **not** automatically current treatment guidance. Medication choices, doses, contraindications, interactions, monitoring and legal practice must be checked against current guideline/regulatory evidence.

## Unknown Case Mode
The learner should receive a vignette without the article title, authors, journal, final diagnosis, definitive outcome, DOI or PMCID. The Brain should:
1. use only facts supported by the source abstract;
2. fictionalize and further de-identify non-essential unique details;
3. hide the final diagnosis and management during the initial encounter;
4. ask one next-step or differential question at a time;
5. reveal the source and source-grounded debrief only after the learner commits.

This produces the educational pattern:

`unknown presentation -> learner history/differential -> reasoning -> reveal -> source-grounded debrief -> current-evidence check -> consultant viva -> mastery update`

## Diversity targets
The corpus should include broad coverage rather than 1,000 near-duplicate psychosis cases. Useful domains include:
- psychosis and catatonia;
- mood disorders;
- addictions and withdrawal;
- anxiety/OCD/trauma/dissociation;
- child and adolescent psychiatry;
- geriatric/neurocognitive presentations;
- psychiatric emergencies;
- psychopharmacology adverse effects/interactions;
- liaison/neuropsychiatry and medical mimics.

## Safety and privacy
Published case reports may contain clinically distinctive details. The training interface must not expose names, institutions, countries, authors, exact calendar dates, employers or other non-essential identifying details in the learner vignette. Exact age should be generalized to an age band when the exact number is not clinically necessary.

The corpus is an educational source library, not a patient registry. The system must never claim that indexed publications are current patients, Helwan patients, or locally observed cases.

## Network separation
The core Psychiatry Brain remains loopback-only and without public internet access. A separate hardened case-harvester process may access only its fixed official literature API implementation and write the case corpus directory. The Brain receives read-only access to that directory. This preserves the isolation boundary while allowing the educational corpus to grow.
