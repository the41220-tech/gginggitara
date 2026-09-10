DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pickup_spots
    WHERE id = 'spot_a'
  ) THEN
    RAISE EXCEPTION 'spot_a pickup spot is required for the pilot';
  END IF;

  UPDATE public.pickup_spots
  SET active = (id = 'spot_a')
  WHERE active IS DISTINCT FROM (id = 'spot_a');

  IF (
    SELECT count(*)
    FROM public.pickup_spots
    WHERE active = true
  ) <> 1 THEN
    RAISE EXCEPTION 'the pilot requires exactly one active pickup spot';
  END IF;
END;
$$;
