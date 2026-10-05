-- Owner wording for the venue. Guarded so it never overwrites a value edited in /admin/event.
update public.event
set location_ar = 'صالة فاطمة كانو، توبلي',
    location_en = 'Fatima Kanoo Hall, Tubli'
where location_ar = 'حملة التبرع بالدم للرجال، صالة فاطمة كانو، توبلي';
