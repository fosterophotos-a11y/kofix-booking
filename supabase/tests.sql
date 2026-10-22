-- Run in Supabase SQL editor AFTER schema.sql. Rolls back; leaves no data.
begin;
do $$ declare a uuid; b uuid; r bookings; i int; ids uuid[]; begin
  update settings set confirm_rule='manual' where id=1;
  insert into packages(category,name) values('T','Test A') returning id into a;
  insert into packages(category,name) values('T','Test B') returning id into b;
  for i in 1..6 loop
    r := create_booking(a,'C'||i,'05000000'||i,null,null,null,null); r := confirm_booking(r.id);
    assert r.slot_no = i, 'slot order';
  end loop;
  begin perform create_booking(a,'X','0599999999',null,null,null,null); assert false,'should be full';
  exception when others then assert sqlerrm='PROMO_FULL','full msg'; end;
  r := create_booking(b,'Other','0500000001',null,null,null,null); r := confirm_booking(r.id);
  assert r.slot_no = 1, 'independent counters';
  begin perform create_booking(b,'Dup','0500000001',null,null,null,null); assert false;
  exception when others then assert sqlerrm='DUPLICATE','dup'; end;
  update bookings set status='cancelled', slot_no=null where package_id=a and name='C3';
  r := create_booking(a,'New','0577777777',null,null,null,null); r := confirm_booking(r.id);
  assert r.slot_no = 3, 'freed slot reused';
  update settings set confirm_rule='deposit' where id=1;
  r := create_booking(b,'Unpaid','0511111111',null,null,null,null);
  begin perform confirm_booking(r.id); assert false; exception when others then assert sqlerrm='PAYMENT_REQUIRED'; end;
  raise notice 'ALL TESTS PASSED';
end $$;
rollback;
