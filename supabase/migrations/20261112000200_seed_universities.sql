-- =============================================================================
-- Migration 0003: starter list of institutions.
--
-- Reference data the app needs in every environment, so it lives in a
-- migration (runs on `supabase db push`) rather than seed.sql.
-- ipeds_id is left null on purpose: scripts/import-ipeds.mjs matches these
-- rows by name + state and fills in the official IPEDS UNITID, so importing
-- the full IPEDS directory later does not create duplicates.
-- Law/medical schools that IPEDS reports as part of their parent university
-- (e.g. BYU Law) stay as separate manual rows.
-- =============================================================================
insert into public.universities (name, city, state, type)
select v.name, v.city, v.state, v.type::public.institution_type
from (values
  -- Utah
  ('Brigham Young University', 'Provo', 'UT', 'university'),
  ('BYU J. Reuben Clark Law School', 'Provo', 'UT', 'law_school'),
  ('University of Utah', 'Salt Lake City', 'UT', 'university'),
  ('University of Utah S.J. Quinney College of Law', 'Salt Lake City', 'UT', 'law_school'),
  ('University of Utah School of Medicine', 'Salt Lake City', 'UT', 'medical_school'),
  ('Utah Valley University', 'Orem', 'UT', 'university'),
  ('Salt Lake Community College', 'Salt Lake City', 'UT', 'community_college'),
  ('Utah State University', 'Logan', 'UT', 'university'),
  ('Weber State University', 'Ogden', 'UT', 'university'),
  ('Southern Utah University', 'Cedar City', 'UT', 'university'),
  ('Utah Tech University', 'St. George', 'UT', 'university'),
  ('Snow College', 'Ephraim', 'UT', 'community_college'),
  ('Westminster University', 'Salt Lake City', 'UT', 'university'),
  ('Rocky Vista University', 'Ivins', 'UT', 'medical_school'),
  ('Brigham Young University-Idaho', 'Rexburg', 'ID', 'university'),
  -- West
  ('Arizona State University Campus Immersion', 'Tempe', 'AZ', 'university'),
  ('University of Arizona', 'Tucson', 'AZ', 'university'),
  ('University of Colorado Boulder', 'Boulder', 'CO', 'university'),
  ('University of Denver', 'Denver', 'CO', 'university'),
  ('University of Nevada-Las Vegas', 'Las Vegas', 'NV', 'university'),
  ('University of Idaho', 'Moscow', 'ID', 'university'),
  ('University of Washington-Seattle Campus', 'Seattle', 'WA', 'university'),
  ('University of Oregon', 'Eugene', 'OR', 'university'),
  ('Lewis & Clark College', 'Portland', 'OR', 'university'),
  ('Stanford University', 'Stanford', 'CA', 'university'),
  ('University of California-Berkeley', 'Berkeley', 'CA', 'university'),
  ('University of California-Los Angeles', 'Los Angeles', 'CA', 'university'),
  ('University of Southern California', 'Los Angeles', 'CA', 'university'),
  ('Pepperdine University', 'Malibu', 'CA', 'university'),
  ('Southwestern Law School', 'Los Angeles', 'CA', 'law_school'),
  ('Santa Monica College', 'Santa Monica', 'CA', 'community_college'),
  -- Midwest / South
  ('University of Chicago', 'Chicago', 'IL', 'university'),
  ('Northwestern University', 'Evanston', 'IL', 'university'),
  ('University of Michigan-Ann Arbor', 'Ann Arbor', 'MI', 'university'),
  ('University of Notre Dame', 'Notre Dame', 'IN', 'university'),
  ('Washington University in St Louis', 'Saint Louis', 'MO', 'university'),
  ('Mitchell Hamline School of Law', 'Saint Paul', 'MN', 'law_school'),
  ('The University of Texas at Austin', 'Austin', 'TX', 'university'),
  ('South Texas College of Law Houston', 'Houston', 'TX', 'law_school'),
  ('Baylor College of Medicine', 'Houston', 'TX', 'medical_school'),
  ('Austin Community College District', 'Austin', 'TX', 'community_college'),
  ('Vanderbilt University', 'Nashville', 'TN', 'university'),
  ('Duke University', 'Durham', 'NC', 'university'),
  ('University of Virginia-Main Campus', 'Charlottesville', 'VA', 'university'),
  ('Emory University', 'Atlanta', 'GA', 'university'),
  -- Northeast
  ('Harvard University', 'Cambridge', 'MA', 'university'),
  ('Yale University', 'New Haven', 'CT', 'university'),
  ('Columbia University in the City of New York', 'New York', 'NY', 'university'),
  ('New York University', 'New York', 'NY', 'university'),
  ('Brooklyn Law School', 'Brooklyn', 'NY', 'law_school'),
  ('Cornell University', 'Ithaca', 'NY', 'university'),
  ('University of Pennsylvania', 'Philadelphia', 'PA', 'university'),
  ('Georgetown University', 'Washington', 'DC', 'university'),
  ('Rockefeller University', 'New York', 'NY', 'graduate_school'),
  ('Northern Virginia Community College', 'Annandale', 'VA', 'community_college')
) as v(name, city, state, type)
where not exists (
  select 1 from public.universities u
  where lower(u.name) = lower(v.name) and u.state = v.state
);
