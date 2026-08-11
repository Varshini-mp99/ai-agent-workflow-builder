INSERT INTO workflow_steps
(workflow_id, step_order, name, type, config)
VALUES
(
  '26bbadf8-c2be-4191-a683-198df060e012',
  1,
  'Classify Customer Request',
  'llm_call',
  '{"prompt":"Classify the customer request into one of these categories: technical_support, billing, sales, general. Return only the category."}'
),
(
  '26bbadf8-c2be-4191-a683-198df060e012',
  2,
  'Route Request',
  'conditional_branch',
  '{"condition":"classification != null","branches":["technical_support","billing","sales","general"]}'
),
(
  '26bbadf8-c2be-4191-a683-198df060e012',
  3,
  'Save Request',
  'db_write',
  '{"table":"workflow_data","operation":"insert"}'
),
(
  '26bbadf8-c2be-4191-a683-198df060e012',
  4,
  'Notify Team',
  'notify',
  '{"channel":"email","message":"Customer support request has been routed successfully."}'
);