"""
Unit tests.

To run a single test, modify the main code to:

```
singletest = unittest.TestSuite()
singletest.addTest(<TEST CASE>("<TEST METHOD NAME>"))
unittest.TextTestRunner().run(singletest)
```

| Copyright 2017-2020, Voxel51, Inc.
| `voxel51.com <https://voxel51.com/>`_
|
"""
import datetime
import unittest

from mongoengine import IntField, StringField, EmbeddedDocumentField
from mongoengine.errors import (
    FieldDoesNotExist,
    NotUniqueError,
    ValidationError,
)

import fiftyone as fo
import fiftyone.core.odm as foo


class DatasetTest(unittest.TestCase):
    def test_pername_singleton(self):
        dataset1 = fo.Dataset("test_dataset")
        dataset2 = fo.Dataset("test_dataset")
        dataset3 = fo.Dataset("another_dataset")
        self.assertIs(dataset1, dataset2)
        self.assertIsNot(dataset1, dataset3)

    def test_backing_doc_class(self):
        dataset = fo.Dataset("test_dataset")
        self.assertTrue(issubclass(dataset._Doc, foo.ODMDatasetSample))


class SampleTest(unittest.TestCase):
    def test_backing_doc_type(self):
        sample = fo.Sample(filepath="path/to/file.jpg")
        self.assertIsInstance(sample._doc, foo.ODMNoDatasetSample)

    def test_get_field(self):
        filepath = "path/to/file.jpg"

        sample = fo.Sample(filepath=filepath)

        # get valid
        self.assertEqual(sample.get_field("filepath"), filepath)
        self.assertEqual(sample["filepath"], filepath)
        self.assertEqual(sample.filepath, filepath)

        # get missing
        with self.assertRaises(KeyError):
            sample.get_field("missing_field")
        with self.assertRaises(KeyError):
            sample["missing_field"]
        with self.assertRaises(AttributeError):
            sample.missing_field

    def test_set_field(self):
        sample = fo.Sample(filepath="path/to/file.jpg")

        value = 51

        # set_field create=False
        with self.assertRaises(ValueError):
            sample.set_field("field1", value, create=False)
        with self.assertRaises(KeyError):
            sample.get_field("field1")
        with self.assertRaises(KeyError):
            sample["field1"]
        with self.assertRaises(AttributeError):
            sample.field1

        # set_field create=True
        sample.set_field(field_name="field2", value=value, create=True)
        fields = sample.get_field_schema()
        self.assertIsInstance(fields["field2"], IntField)
        self.assertIsInstance(sample.field2, int)
        self.assertEqual(sample.get_field("field2"), value)
        self.assertEqual(sample["field2"], value)
        self.assertEqual(sample.field2, value)

        # __setitem__
        sample["field3"] = value
        self.assertEqual(sample.get_field("field3"), value)
        self.assertEqual(sample["field3"], value)
        self.assertEqual(sample.field3, value)

        # __setattr__
        # @todo(Tyler) logger.warning(...)
        # with self.assertWarns():
        sample.field4 = value
        with self.assertRaises(KeyError):
            sample.get_field("field4")
        with self.assertRaises(KeyError):
            sample["field4"]
        self.assertEqual(sample.field4, value)

    def test_change_value(self):
        sample = fo.Sample(filepath="path/to/file.jpg")

        # init
        value = 51
        sample["test_field"] = value
        self.assertEqual(sample.test_field, value)

        # update setitem
        value = 52
        sample["test_field"] = value
        self.assertEqual(sample.test_field, value)

        # update setattr
        value = 53
        sample.test_field = value
        self.assertEqual(sample.test_field, value)


class SampleInDatasetTest(unittest.TestCase):
    def test_autopopulated_fields(self):
        dataset_name = "test_dataset"
        dataset = fo.Dataset(name=dataset_name)
        sample = fo.Sample(filepath="path/to/file.jpg")

        self.assertIsNone(sample.id)
        self.assertIsNone(sample.ingest_time)
        self.assertFalse(sample.in_dataset)
        self.assertIsNone(sample.dataset_name)

        dataset.add_sample(sample)

        self.assertIsNotNone(sample.id)
        self.assertIsInstance(sample.id, str)
        self.assertIsInstance(sample.ingest_time, datetime.datetime)
        self.assertTrue(sample.in_dataset)
        self.assertEqual(sample.dataset_name, dataset_name)


class LabelsTest(unittest.TestCase):
    def test_create(self):
        labels = fo.Classification(label="cow", confidence=0.98)
        self.assertIsInstance(labels, fo.Classification)

        with self.assertRaises(FieldDoesNotExist):
            fo.Classification(made_up_field=100)

        with self.assertRaises(ValidationError):
            fo.Classification(label=100)


class CRUDTest(unittest.TestCase):
    """Create, Read, Update, Delete (CRUD)"""

    def test_create_sample(self):
        dataset_name = "crud_test"
        dataset = fo.Dataset(dataset_name)
        filepath = "path/to/file.txt"
        sample = fo.Sample(filepath=filepath, tags=["tag1", "tag2"])
        self.assertEqual(len(dataset), 0)

        dataset.add_sample(sample)
        self.assertEqual(len(dataset), 1)

        # add duplicate filepath
        with self.assertRaises(NotUniqueError):
            dataset.add_sample(fo.Sample(filepath=filepath))
        self.assertEqual(len(dataset), 1)

        # update assign
        tag = "tag3"
        sample.tags = [tag]
        sample.save()
        self.assertEqual(len(sample.tags), 1)
        self.assertEqual(sample.tags[0], tag)
        sample2 = dataset[sample.id]
        self.assertEqual(len(sample2.tags), 1)
        self.assertEqual(sample2.tags[0], tag)

        # update append
        tag = "tag4"
        sample.tags.append(tag)
        sample.save()
        self.assertEqual(len(sample.tags), 2)
        self.assertEqual(sample.tags[-1], tag)
        sample2 = dataset[sample.id]
        self.assertEqual(len(sample2.tags), 2)
        self.assertEqual(sample2.tags[-1], tag)

        # update add new field
        dataset.add_sample_field(
            field_name="test_label",
            ftype=EmbeddedDocumentField,
            embedded_doc_type=fo.Classification,
        )
        sample.test_label = fo.Classification(label="cow")
        self.assertEqual(sample.test_label.label, "cow")
        sample.save()
        self.assertEqual(sample.test_label.label, "cow")
        sample2 = dataset[sample.id]
        self.assertEqual(sample2.test_label.label, "cow")

        # update modify embedded document
        sample.test_label.label = "chicken"
        self.assertEqual(sample.test_label.label, "chicken")
        sample.save()
        self.assertEqual(sample.test_label.label, "chicken")
        sample2 = dataset[sample.id]
        self.assertEqual(sample2.test_label.label, "chicken")

        # print("Removing tag 'tag1'")
        # sample.remove_tag("tag1")
        # print("Num samples: %d" % len(dataset))
        # for sample in dataset.iter_samples():
        #     print(sample)
        # print()
        #
        #
        # print("Adding new tag: 'tag2'")
        # sample.add_tag("tag2")
        # print("Num samples: %d" % len(dataset))
        # for sample in dataset.iter_samples():
        #     print(sample)
        # print()
        #
        # print("Deleting sample")
        # del dataset[sample.id]
        # print("Num samples: %d" % len(dataset))
        # for sample in dataset.iter_samples():
        #     print(sample)
        # print()


class ViewTest(unittest.TestCase):
    def test_view(self):
        dataset = fo.Dataset("view_test_dataset")
        dataset.add_sample_field(
            field_name="labels",
            ftype=EmbeddedDocumentField,
            embedded_doc_type=fo.Classification,
        )

        sample = fo.Sample(
            "1.jpg", tags=["train"], labels=fo.Classification(label="label1")
        )
        dataset.add_sample(sample)

        sample = fo.Sample(
            "2.jpg", tags=["test"], labels=fo.Classification(label="label2")
        )
        dataset.add_sample(sample)

        view = dataset.view()

        self.assertEqual(len(view), len(dataset))
        self.assertIsInstance(view.first(), fo.Sample)

        # tags
        for sample in view.match({"tags": "train"}):
            self.assertIn("train", sample.tags)
        for sample in view.match({"tags": "test"}):
            self.assertIn("test", sample.tags)

        # labels
        for sample in view.match({"labels.label": "label1"}):
            self.assertEqual(sample.labels.label, "label1")


class FieldTest(unittest.TestCase):
    def test_field_AddDelete_in_dataset(self):
        foo.drop_database()
        dataset = fo.Dataset(name="field_test")
        id1 = dataset.add_sample(fo.Sample("1.jpg"))
        id2 = dataset.add_sample(fo.Sample("2.jpg"))
        sample1 = dataset[id1]
        sample2 = dataset[id2]

        # add field (default duplicate)
        with self.assertRaises(ValueError):
            dataset.add_sample_field(field_name="filepath", ftype=StringField)

        # delete default field
        # @todo(Tyler) should the user just be allowed to do this?

        field_name = "field1"
        ftype = StringField
        field_test_value = "test_field_value"

        # access non-existent field
        with self.assertRaises(KeyError):
            dataset.get_sample_fields()[field_name]
        for sample in [sample1, sample2, dataset[id1], dataset[id2]]:
            with self.assertRaises(KeyError):
                sample.get_field_schema()[field_name]
            with self.assertRaises(KeyError):
                sample.get_field(field_name)
            with self.assertRaises(KeyError):
                sample[field_name]
            with self.assertRaises(AttributeError):
                getattr(sample, field_name)
            with self.assertRaises(KeyError):
                sample.to_dict()[field_name]

        # add field (new)
        dataset.add_sample_field(field_name=field_name, ftype=ftype)
        setattr(sample1, field_name, field_test_value)
        sample1.save()

        # check field exists and is of correct type
        field = dataset.get_sample_fields()[field_name]
        self.assertIsInstance(field, ftype)
        for sample in [sample1, dataset[id1]]:
            # check field exists and is of correct type
            field = sample.get_field_schema()[field_name]
            self.assertIsInstance(field, ftype)
            # check field exists on sample and is set correctly
            self.assertEqual(
                sample.get_field(field_name=field_name), field_test_value
            )
            self.assertEqual(sample[field_name], field_test_value)
            self.assertEqual(getattr(sample, field_name), field_test_value)
            self.assertEqual(sample.to_dict()[field_name], field_test_value)
        for sample in [sample2, dataset[id2]]:
            # check field exists and is of correct type
            field = sample.get_field_schema()[field_name]
            self.assertIsInstance(field, ftype)
            # check field exists on sample and is None
            self.assertIsNone(sample.get_field(field_name=field_name))
            self.assertIsNone(sample[field_name])
            self.assertIsNone(getattr(sample, field_name))
            self.assertIsNone(sample.to_dict()[field_name])

        # add field (duplicate)
        with self.assertRaises(ValueError):
            dataset.add_sample_field(field_name=field_name, ftype=ftype)

        # delete field
        dataset.delete_sample_field(field_name=field_name)

        # access non-existent field
        with self.assertRaises(KeyError):
            dataset.get_sample_fields()[field_name]
        for sample in [sample1, sample2, dataset[id1], dataset[id2]]:
            with self.assertRaises(KeyError):
                sample.get_field_schema()[field_name]
            with self.assertRaises(KeyError):
                sample.get_field(field_name)
            with self.assertRaises(KeyError):
                sample[field_name]
            with self.assertRaises(AttributeError):
                getattr(sample, field_name)
            with self.assertRaises(KeyError):
                sample.to_dict()[field_name]

        # add deleted field with new type
        ftype = IntField
        field_test_value = 51
        dataset.add_sample_field(field_name=field_name, ftype=ftype)
        setattr(sample1, field_name, field_test_value)
        sample1.save()

        # check field exists and is of correct type
        field = dataset.get_sample_fields()[field_name]
        self.assertIsInstance(field, ftype)
        for sample in [sample1, dataset[id1]]:
            # check field exists and is of correct type
            field = sample.get_field_schema()[field_name]
            self.assertIsInstance(field, ftype)
            # check field exists on sample and is set correctly
            self.assertEqual(
                sample.get_field(field_name=field_name), field_test_value
            )
            self.assertEqual(sample[field_name], field_test_value)
            self.assertEqual(getattr(sample, field_name), field_test_value)
            self.assertEqual(sample.to_dict()[field_name], field_test_value)
        for sample in [sample2, dataset[id2]]:
            # check field exists and is of correct type
            field = sample.get_field_schema()[field_name]
            self.assertIsInstance(field, ftype)
            # check field exists on sample and is None
            self.assertIsNone(sample.get_field(field_name=field_name))
            self.assertIsNone(sample[field_name])
            self.assertIsNone(getattr(sample, field_name))
            self.assertIsNone(sample.to_dict()[field_name])

    def test_field_GetSetClear_no_dataset(self):
        sample = fo.Sample("1.jpg")

        # set field (default duplicate)

        # add field (new)

        # add field (duplicate)

        # delete field

        # add deleted field

    def test_field_GetSetClear_in_dataset(self):
        foo.drop_database()
        dataset = fo.Dataset(name="field_test")
        dataset.add_sample(fo.Sample("1.jpg"))
        dataset.add_sample(fo.Sample("2.jpg"))

        # add field (default duplicate)

        # add field (new)

        # add field (duplicate)

        # delete field

        # add deleted field


if __name__ == "__main__":
    unittest.main()
