-- Backfill product fragrance intensities based on slug mappings
UPDATE "Product"
SET "intensity" = CASE "slug"
  WHEN 'keravelle' THEN 'MODERATE'::"Intensity"
  WHEN 'barco' THEN 'STRONG'::"Intensity"
  WHEN 'travies' THEN 'STRONG'::"Intensity"
  WHEN 'stellar' THEN 'MODERATE'::"Intensity"
  WHEN 'brulant' THEN 'STRONG'::"Intensity"
  WHEN 'apple-vanilla' THEN 'STRONG'::"Intensity"
  WHEN 'la-grace' THEN 'MODERATE'::"Intensity"
  WHEN 'monarch-absolute' THEN 'IMPACTFUL'::"Intensity"
  WHEN 'petales-dores' THEN 'LIGHT'::"Intensity"
  WHEN 'triumph' THEN 'STRONG'::"Intensity"
  WHEN 'azur-infini' THEN 'LIGHT'::"Intensity"
  WHEN 'opale-feliniya' THEN 'IMPACTFUL'::"Intensity"
  WHEN 'embre-jazor' THEN 'MODERATE'::"Intensity"
  WHEN 'oud-raafi' THEN 'STRONG'::"Intensity"
  WHEN 'oud-al-jazor' THEN 'IMPACTFUL'::"Intensity"
  WHEN 'ombre-silk' THEN 'MODERATE'::"Intensity"
  WHEN 'saraya' THEN 'STRONG'::"Intensity"
  WHEN 'velvet-dates' THEN 'MODERATE'::"Intensity"
  WHEN 'velvet-brew' THEN 'IMPACTFUL'::"Intensity"
  WHEN 'alatef' THEN 'IMPACTFUL'::"Intensity"
  WHEN 'noor-al-yasmin' THEN 'MODERATE'::"Intensity"
  WHEN 'jizaa-al-qadim' THEN 'IMPACTFUL'::"Intensity"
  WHEN 'oud-al-abyad' THEN 'STRONG'::"Intensity"
  WHEN 'oud-al-shams' THEN 'STRONG'::"Intensity"
END
WHERE "slug" IN (
  'keravelle', 'barco', 'travies', 'stellar', 'brulant',
  'apple-vanilla', 'la-grace', 'monarch-absolute', 'petales-dores',
  'triumph', 'azur-infini', 'opale-feliniya', 'embre-jazor',
  'oud-raafi', 'oud-al-jazor', 'ombre-silk', 'saraya', 'velvet-dates',
  'velvet-brew', 'alatef', 'noor-al-yasmin', 'jizaa-al-qadim',
  'oud-al-abyad', 'oud-al-shams'
);
