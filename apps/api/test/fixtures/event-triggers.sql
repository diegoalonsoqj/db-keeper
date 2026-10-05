--
-- PostgreSQL database dump
--

-- Dumped from database version 16.9
-- Dumped by pg_dump version 16.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: log_ddl(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_ddl() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE NOTICE 'ddl'; END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: t; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.t (
    a text
);


--
-- Data for Name: t; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.t (a) FROM stdin;
CREATE EVENT TRIGGER trg_ddl_command_end_events ON x;
\.


--
-- Name: Trg Raro;x; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER "Trg Raro;x" ON ddl_command_start
   EXECUTE FUNCTION public.log_ddl();

ALTER EVENT TRIGGER "Trg Raro;x" DISABLE;


--
-- Name: trg_ddl_command_end_events; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER trg_ddl_command_end_events ON ddl_command_end
         WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE')
   EXECUTE FUNCTION public.log_ddl();


--
-- Name: EVENT TRIGGER trg_ddl_command_end_events; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EVENT TRIGGER trg_ddl_command_end_events IS 'audita; DDL
en dos líneas';


--
-- PostgreSQL database dump complete
--

