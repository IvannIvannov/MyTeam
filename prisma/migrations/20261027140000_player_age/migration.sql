ALTER TABLE players ADD COLUMN age INTEGER;
UPDATE players SET age = EXTRACT(YEAR FROM age(CURRENT_DATE, birth_date))::INTEGER
WHERE birth_date IS NOT NULL AND birth_date <= CURRENT_DATE;
ALTER TABLE players ADD CONSTRAINT players_age_nonnegative CHECK (age >= 0);
