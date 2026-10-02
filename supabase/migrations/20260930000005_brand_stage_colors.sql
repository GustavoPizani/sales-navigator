-- Cores das etapas na identidade Paes & Gregori (grafite, cinzas e cobre).
UPDATE public.funnel_stages SET color = CASE kind
  WHEN 'new'             THEN '#A8A8A8'
  WHEN 'contact'         THEN '#646464'
  WHEN 'visit_scheduled' THEN '#2D2D2D'
  WHEN 'visit_done'      THEN '#7E5845'
  WHEN 'proposal'        THEN '#B28069'
  WHEN 'sale'            THEN '#4E7D5B'
  ELSE color
END
WHERE kind IS NOT NULL;
